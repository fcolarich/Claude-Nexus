/**
 * Distill — LLM-driven cleanup of EXISTING memories.
 *
 * Where consolidation merges near-identical duplicates structurally, distill
 * goes further: it clusters *related* memories (medium similarity) and rewrites
 * each cluster into one tighter, non-redundant memory, then sanitizes verbose
 * singletons. Use it to clean up legacy / hand-written memories.
 *
 * The rewrite is mechanical (compress these given texts) rather than judgment —
 * a local model is a reasonable choice here. Uses the configured extraction
 * model via callModel().
 */

import Database from 'better-sqlite3';
import { appendFileSync } from 'node:fs';
import { getNexusConfig } from './config.js';
import { generateEmbedding } from './embeddings.js';
import { callModel } from './llm.js';
import { embedUnindexedMemories, insertMemory, embedMemory, normalize } from './memories.js';
import { resolveProjectFromCwd } from './project-root.js';
import { extractIdentifiers, unionIdentifiers } from './identifiers.js';
import type { Memory, MemoryType, DecayClass, AtomScope } from './types.js';

// Below: unrelated. At/above the dedup threshold (0.86): consolidate's job.
// Left at 0.70 deliberately. Raising it to 0.75 was measured against 1028 real
// merges and would have dropped 48.5% of the gated pairs — half of all
// consolidation — to address a defect present in 1.6% of them. MERGE_COVERAGE_FLOOR
// below rejects those cases directly instead.
const BAND_LOW = 0.70;

// A merge must land within this cosine of EVERY source it folds in. Distill is
// destructive, so a rewrite that ignores one of its sources silently deletes that
// memory. Checked at write time against the vectors already in memories_vec.
// Calibrated from the same 1028-merge audit: minCos p10 0.77, p50 0.84, p90 0.89,
// so 0.72 rejects the genuine tail without touching healthy merges.
const MERGE_COVERAGE_FLOOR = 0.72;
// Lowered 4 -> 3 (was 8 -> 4, see note-003). A 2026-07-26 audit of 678 real
// merges found ~30% of code-like identifiers silently dropped: the more memories
// packed into one rewrite, the more specifics the model discards. Fewer sources
// per merge means fewer facts competing for space.
const MAX_CLUSTER = 3;

// Consecutive failed model calls before a run gives up. The cursor is stamped
// before each candidate is worked so a crash cannot cost progress — but that also
// means a dead backend would burn straight through the pool, marking everything
// examined while producing nothing. Observed 2026-07-26: Ollama died mid-sweep and
// one chunk consumed 300 candidates for 0 merges. On abort, every candidate this
// run did not genuinely process has its stamp cleared.
const LLM_FAILURE_ABORT = 5;
const SANITIZE_OVER_CHARS = 800;

const MEMORY_TYPES = new Set(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']);
const DECAY_CLASSES = new Set(['stable', 'architecture', 'api_contract', 'implementation']);
const SCOPES = new Set(['global', 'shared', 'project']);

export interface DistillOptions {
  project?: string;   // project slug to scope to; literal "global" targets the global bucket
  cwd?: string;        // derive project slug when project is omitted (resolveProjectFromCwd — same helper as nexus_backfill/nexus_search)
  limit?: number;      // max candidate memories pulled into the clustering pool (default 200, hard cap 500)
  dryRun?: boolean;    // count eligibility only; never call callFn or embedFn
  since?: string;      // sweep cursor cutoff: also re-examine memories whose distilled_at is older than this. Omit to only take never-examined ones.
}

export interface DistillResult {
  embedded: number;   // memories embedded before distilling
  clusters: number;   // related-memory clusters found
  merged: number;     // original memories folded into a consolidation
  created: number;    // new consolidated memories written
  rejected: number;   // merges discarded by the coverage gate; their sources left intact
  sanitized: number;  // verbose singletons tightened in place
  backendFailed: boolean;  // run aborted on consecutive model-call failures; unprocessed candidates were un-stamped
  processed: number;          // candidate memories examined this run (<= limit)
  eligibleRemaining: number;  // eligible memories under this scope still un-examined AFTER this run — reaches 0 when the sweep is complete
  scope: string;              // resolved scope label: project slug, "global", or "all"
  dryRun: boolean;
}

/**
 * Exported so scripts/check-merge-model.mjs gates a candidate merge model against
 * the exact prompt distill uses, rather than a copy that can drift.
 *
 * The sentence budget scales with cluster size. The previous flat "1-4 sentences"
 * contradicted "drop nothing that matters" — a cluster of information-dense
 * memories cannot fit in 4 sentences, so models obeyed the cap and silently
 * discarded identifiers. An audit of 678 real merges (2026-07-26) measured ~30%
 * of file names, script names, config keys and shader keywords lost, on both
 * Haiku and a local model. Since distill supersedes the originals, that is
 * permanent loss, so the budget now yields to the facts rather than the reverse.
 */
export const mergePrompt = (clusterSize: number) => `You consolidate related memories into one.

Given several memories about overlapping topics, write a SINGLE memory that captures every distinct fact and rationale from all of them — tighter, clearer, no redundancy. Keep the most specific information; drop nothing that matters.

NON-NEGOTIABLE: reproduce every identifier VERBATIM — file names and paths, function/script/class names, config keys, CLI flags, shader keywords, numbers, versions, URLs. Compress prose, never identifiers. Where two sources state the same value at different precision, keep the more precise one. A longer body is always better than an omitted identifier.

Output STRICT JSON ONLY, one object:
{"title": "...", "body": "...", "memory_type": "...", "scope": "...", "decay_class": "...", "tags": ["..."]}

memory_type: preference|convention|failure|correction|decision|insight|tool_quirk|reference|handoff
scope: project|global|shared
decay_class: stable|architecture|api_contract|implementation
body: up to ${clusterSize * 3} self-contained sentences — use as many as the facts require, no more. No prose or fences outside the JSON.`;

// Same identifier rule as the merge prompt: sanitize rewrites a memory in place,
// so anything it drops is gone too.
export const SANITIZE_PROMPT = `Tighten this memory. Remove redundancy and filler; keep every distinct fact and the reasoning. Do not add anything.

Reproduce every identifier VERBATIM — file names and paths, function/script/class names, config keys, CLI flags, numbers, versions, URLs. Compress prose, never identifiers.

Output STRICT JSON ONLY: {"title": "...", "body": "..."}  No prose or fences.`;

// Exported for unit testing only — not part of the public distill.ts contract
// (distillMemories/DistillOptions/DistillResult remain the only intended external surface).
export type ResolvedScope = { kind: 'project'; slug: string } | { kind: 'global' } | { kind: 'all' };

/**
 * Maps DistillOptions -> ResolvedScope. `project` wins over `cwd`; literal
 * `project: "global"` targets the global bucket. `cwd` derives a slug via
 * resolveProjectFromCwd — the same fallback-enhanced resolver nexus_backfill
 * and nexus_search use, so a project stored only under a short-name slug
 * still resolves instead of silently degrading to "all" (a clean-zero run).
 */
export function resolveScope(db: Database.Database, opts: DistillOptions | undefined): ResolvedScope {
  if (opts?.project) {
    return opts.project === 'global' ? { kind: 'global' } : { kind: 'project', slug: opts.project };
  }
  if (opts?.cwd) {
    const slug = resolveProjectFromCwd(db, opts.cwd);
    if (slug) return { kind: 'project', slug };
  }
  return { kind: 'all' };
}

/**
 * The sweep cursor predicate. A memory is a candidate only while it has never
 * been examined (`distilled_at IS NULL`), or — when the caller passes `since` —
 * was last examined before that cutoff. Without this, every invocation re-pulls
 * the identical top-`limit` window and a large scope can never be swept.
 */
export function cursorClause(since: string | undefined): string {
  return since ? `(distilled_at IS NULL OR distilled_at < :since)` : `distilled_at IS NULL`;
}

/** Pure SQL builder over the scope + cursor filter. Appends LIMIT :limit — countEligible never does. */
export function buildEligibleQuery(scope: ResolvedScope, limit: number, since?: string): { sql: string; params: Record<string, unknown> } {
  const cursor = cursorClause(since);
  const sinceParam = since ? { since } : {};
  if (scope.kind === 'project') {
    return {
      sql: `SELECT * FROM memories WHERE project = :slug AND scope != 'global' AND superseded_by IS NULL AND review_status != 'rejected' AND ${cursor} ORDER BY confidence DESC, created_at ASC LIMIT :limit`,
      params: { slug: scope.slug, limit, ...sinceParam },
    };
  }
  if (scope.kind === 'global') {
    return {
      sql: `SELECT * FROM memories WHERE scope = 'global' AND superseded_by IS NULL AND review_status != 'rejected' AND ${cursor} ORDER BY confidence DESC, created_at ASC LIMIT :limit`,
      params: { limit, ...sinceParam },
    };
  }
  return {
    sql: `SELECT * FROM memories WHERE superseded_by IS NULL AND review_status != 'rejected' AND ${cursor} ORDER BY confidence DESC, created_at ASC LIMIT :limit`,
    params: { limit, ...sinceParam },
  };
}

/**
 * Count of rows under scope that the cursor still considers un-examined — same
 * filter as buildEligibleQuery, no LIMIT. This is genuine remaining work, so a
 * caller looping until it hits 0 terminates.
 */
export function countEligible(db: Database.Database, scope: ResolvedScope, since?: string): number {
  const cursor = cursorClause(since);
  const params: Record<string, unknown> = {};
  if (since) params.since = since;

  let sql: string;
  if (scope.kind === 'project') {
    params.slug = scope.slug;
    sql = `SELECT COUNT(*) c FROM memories WHERE project = :slug AND scope != 'global' AND superseded_by IS NULL AND review_status != 'rejected' AND ${cursor}`;
  } else if (scope.kind === 'global') {
    sql = `SELECT COUNT(*) c FROM memories WHERE scope = 'global' AND superseded_by IS NULL AND review_status != 'rejected' AND ${cursor}`;
  } else {
    sql = `SELECT COUNT(*) c FROM memories WHERE superseded_by IS NULL AND review_status != 'rejected' AND ${cursor}`;
  }

  const stmt = db.prepare(sql);
  return ((Object.keys(params).length ? stmt.get(params) : stmt.get()) as { c: number }).c;
}

/** Normalize a raw limit input into [1, 500], defaulting to 200. Fractions floor. */
function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || limit === null || Number.isNaN(limit) || limit <= 0) return 200;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

/** Resolve a scope label for DistillResult.scope. */
function scopeLabel(scope: ResolvedScope): string {
  if (scope.kind === 'project') return scope.slug;
  return scope.kind;
}

function rowToMemory(r: Record<string, unknown>): Memory {
  return {
    ...(r as unknown as Memory),
    tags: JSON.parse((r.tags as string) || '[]'),
    identifiers: JSON.parse((r.identifiers as string) || '[]'),
  };
}

/**
 * Double any backslash that does not begin a legal JSON escape.
 *
 * Memories about code carry regexes and Windows paths — `\s+`, `\d`, `C:\Fran\…`.
 * Models reproduce those backslashes literally, and JSON allows only
 * \" \\ \/ \b \f \n \r \t \uXXXX, so an otherwise perfect merge fails to parse.
 * Observed repeatedly on the low-confidence tail, where nearly every memory is
 * code-related. Applied only as a last resort, after strict parsing has failed.
 */
function repairJsonEscapes(s: string): string {
  // `u` is only a legal escape when 4 hex digits follow. Treating a bare `\u` as
  // valid — as the first version of this did — leaves `C:\Fran_Unity\unity-…`
  // unparseable, because `\unit` is not a Unicode escape. Requiring the hex is
  // what makes Windows paths and regexes survive.
  return s.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');
}

/**
 * Reject text showing signs of a mangled escape sequence.
 *
 * Some ambiguity is irreducible: in `C:\temp`, `\t` IS a legal JSON tab escape,
 * so a model that fails to double its backslashes yields `C:<TAB>emp` and no
 * parser can tell that from an intended tab. What we CAN say is that a merge body
 * is prose — control characters and bidi marks never belong in one — so their
 * presence means an escape was misread. Rejecting costs a cluster the cursor will
 * re-offer; accepting writes corruption over originals that are then superseded.
 */
export function hasEscapeDamage(text: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200e\u200f\u202a-\u202e\u2066-\u2069]|\t/.test(text);
}

function firstJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { parsed = JSON.parse(m[0]); }
    catch {
      try { parsed = JSON.parse(repairJsonEscapes(m[0])); } catch { return null; }
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

/**
 * Read a memory's already-stored embedding straight from memories_vec by
 * SQLite rowid — no schema change, no Ollama call. Returns null on any miss
 * (no row yet, or memories_vec/sqlite-vec unavailable) so callers fall back
 * to embedFn(m.body).
 */
export function loadStoredVector(db: Database.Database, memoryId: number): Float32Array | null {
  let row: { embedding: Buffer } | undefined;
  try {
    row = db.prepare(`SELECT embedding FROM memories_vec WHERE rowid = ?`).get(memoryId) as { embedding: Buffer } | undefined;
  } catch {
    return null; // memories_vec absent (sqlite-vec not loaded)
  }
  if (!row?.embedding) return null;
  return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

/**
 * Cosine of a freshly written merge against every source it folded in, returning
 * the worst offender when any falls below MERGE_COVERAGE_FLOOR, else null.
 *
 * Vectors are stored normalized (embedMemory -> normalize), so cosine is a dot
 * product — no embedding calls, no model. Returns null when vectors are
 * unreadable (sqlite-vec absent): the gate fails OPEN, preserving today's
 * behaviour rather than blocking all merges on an unrelated capability.
 */
export function coverageShortfall(
  db: Database.Database, mergeId: string, sources: Memory[], floor = MERGE_COVERAGE_FLOOR
): { sourceId: string; similarity: number } | null {
  const rowidOf = (id: string) =>
    (db.prepare(`SELECT rowid FROM memories WHERE id = ?`).get(id) as { rowid: number } | undefined)?.rowid;

  const mergeRow = rowidOf(mergeId);
  const mergeVec = mergeRow === undefined ? null : loadStoredVector(db, mergeRow);
  if (!mergeVec) return null;

  let worst: { sourceId: string; similarity: number } | null = null;
  for (const s of sources) {
    const r = rowidOf(s.id);
    const sv = r === undefined ? null : loadStoredVector(db, r);
    if (!sv || sv.length !== mergeVec.length) continue;
    let dot = 0;
    for (let i = 0; i < mergeVec.length; i++) dot += mergeVec[i] * sv[i];
    if (dot < floor && (worst === null || dot < worst.similarity)) worst = { sourceId: s.id, similarity: dot };
  }
  return worst;
}

/** KNN over memories_vec, returning memories whose similarity falls in the related band. */
function relatedMemories(
  db: Database.Database, queryVec: Float32Array, self: Memory, highExclusive: number
): { memory: Memory; similarity: number }[] {
  let rows: { rowid: number; distance: number }[];
  try {
    rows = db.prepare(`
      SELECT rowid, distance FROM memories_vec
      WHERE embedding MATCH json(?) ORDER BY distance LIMIT ?
    `).all(JSON.stringify(Array.from(queryVec)), 12) as { rowid: number; distance: number }[];
  } catch {
    return [];
  }
  const out: { memory: Memory; similarity: number }[] = [];
  for (const r of rows) {
    const row = db.prepare(`SELECT * FROM memories WHERE rowid = ?`).get(r.rowid) as Record<string, unknown> | undefined;
    if (!row) continue;
    const mem = rowToMemory(row);
    if (mem.id === self.id || mem.superseded_by) continue;
    if (mem.scope !== self.scope || mem.project !== self.project) continue;
    const similarity = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
    if (similarity >= BAND_LOW && similarity < highExclusive) out.push({ memory: mem, similarity });
  }
  return out;
}

export async function distillMemories(
  db: Database.Database,
  opts?: DistillOptions,
  embedFn: (text: string) => Promise<Float32Array | null> = generateEmbedding,
  callFn: (system: string, user: string) => Promise<string> = callModel
): Promise<DistillResult> {
  const clampedLimit = normalizeLimit(opts?.limit);
  const scope = resolveScope(db, opts);
  const since = opts?.since;

  if (opts?.dryRun) {
    const countEligibleSnapshot = countEligible(db, scope, since);
    const processed = Math.min(countEligibleSnapshot, clampedLimit);
    return {
      embedded: 0, clusters: 0, merged: 0, created: 0, rejected: 0, sanitized: 0, backendFailed: false,
      processed,
      // Projection, not a measurement: a dry run marks nothing, so this is what
      // the real run would leave behind.
      eligibleRemaining: countEligibleSnapshot - processed,
      scope: scopeLabel(scope),
      dryRun: true,
    };
  }

  const dedupThreshold = getNexusConfig().capture.dedup_cosine_threshold;
  const { embedded } = await embedUnindexedMemories(db, embedFn);

  const { sql, params } = buildEligibleQuery(scope, clampedLimit, since);
  const all = (db.prepare(sql).all(params) as Record<string, unknown>[]).map(rowToMemory);

  const assigned = new Set<string>();
  const result: DistillResult = {
    embedded, clusters: 0, merged: 0, created: 0, rejected: 0, sanitized: 0, backendFailed: false,
    processed: all.length,
    eligibleRemaining: 0,  // measured after the sweep advances the cursor, below
    scope: scopeLabel(scope),
    dryRun: false,
  };

  const supersede = db.prepare(`UPDATE memories SET superseded_by = ?, updated_at = datetime('now') WHERE id = ?`);
  const link = db.prepare(
    `INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence) VALUES (?, ?, 'refines', 1.0)`
  );
  const markDistilled = db.prepare(`UPDATE memories SET distilled_at = ? WHERE id = ?`);
  const unmarkDistilled = db.prepare(`UPDATE memories SET distilled_at = NULL WHERE id = ?`);
  const runStamp = (db.prepare(`SELECT datetime('now') AS t`).get() as { t: string }).t;
  let consecutiveFailures = 0;
  let consecutiveEmbedFailures = 0;

  // ── Cluster + merge ────────────────────────────────────────────────
  for (const [index, m] of all.entries()) {
    // Already handled as another candidate's cluster member. Skip WITHOUT
    // stamping: members of a successful cluster get superseded and leave
    // eligibility on their own, while members of a cluster whose merge failed
    // were deliberately released and must stay eligible for a later run.
    if (assigned.has(m.id)) continue;
    // Advance the cursor before any work that can fail — a crash mid-sweep must
    // not cost progress already made, and the next run must start past here.
    markDistilled.run(runStamp, m.id);
    // Prefer the vector already sitting in memories_vec (stored by
    // embedUnindexedMemories above, or an earlier run) — only pay for a fresh
    // Ollama call on an actual miss (rare, post-embedUnindexedMemories).
    const rowidRow = db.prepare(`SELECT rowid FROM memories WHERE id = ?`).get(m.id) as { rowid: number } | undefined;
    const stored = rowidRow ? loadStoredVector(db, rowidRow.rowid) : null;
    const vec = stored ?? await embedFn(m.body);
    if (!vec) {
      // No vector means this candidate was never actually compared to anything.
      // Hand it back rather than counting it examined — the same trap as a failed
      // merge call, reached through the embedding backend instead.
      unmarkDistilled.run(m.id);
      assigned.add(m.id);
      if (++consecutiveEmbedFailures >= LLM_FAILURE_ABORT) {
        for (const rest of all.slice(index + 1)) unmarkDistilled.run(rest.id);
        result.backendFailed = true;
        break;
      }
      continue;
    }
    consecutiveEmbedFailures = 0;

    const related = relatedMemories(db, normalize(vec), m, dedupThreshold)
      .filter(r => !assigned.has(r.memory.id));
    if (related.length === 0) { assigned.add(m.id); continue; }

    const cluster = [m, ...related.map(r => r.memory)].slice(0, MAX_CLUSTER);
    for (const c of cluster) assigned.add(c.id);
    result.clusters++;

    const listing = cluster
      .map((c, i) => `[${i + 1}] (${c.memory_type}) ${c.title}\n${c.body}`)
      .join('\n\n');
    const raw = await callFn(mergePrompt(cluster.length), listing);
    const obj = firstJsonObject(raw);
    if (!obj || typeof obj.title !== 'string' || typeof obj.body !== 'string'
        || hasEscapeDamage(`${obj.title}\n${obj.body}`)) {
      // Log the unusable response, not just the fact of failure. A silent skip
      // here is indistinguishable from a dead backend, an over-long response, a
      // JSON-shaped reply with the wrong field types, and an empty string — all
      // of which have been guessed at rather than observed.
      const why = !raw ? 'empty response (backend down or timed out)'
        : !obj ? `no JSON object in ${raw.length} chars`
        : `JSON present but title/body not strings (title=${typeof obj.title}, body=${typeof obj.body})`;
      console.warn(`[distill] unusable merge response for cluster of ${cluster.length}: ${why}` +
        (raw ? ` | first 200: ${raw.slice(0, 200).replace(/\s+/g, ' ')}` : ''));
      // A 200-char preview repeatedly proved too little to diagnose these — the
      // defect kept sitting past the cutoff. Dump the whole response plus the
      // exact JSON.parse error so the failure can be read rather than guessed at.
      if (raw && process.env.NEXUS_DUMP_UNPARSEABLE) {
        const m = raw.match(/\{[\s\S]*\}/);
        let parseError = 'no {...} span found';
        if (m) {
          try { JSON.parse(m[0]); parseError = 'strict parse OK (failed the type check instead)'; }
          catch (e) { parseError = (e as Error).message; }
        }
        try {
          appendFileSync(process.env.NEXUS_DUMP_UNPARSEABLE,
            `\n===== cluster of ${cluster.length} | ${why}\n----- parse error: ${parseError}\n${raw}\n`);
        } catch { /* diagnostics must never break the sweep */ }
      }
      // Give the candidates back: an unusable response means they were never
      // really examined, so they must stay eligible for a later run.
      for (const c of cluster) unmarkDistilled.run(c.id);
      if (++consecutiveFailures >= LLM_FAILURE_ABORT) {
        // The backend is down, not merely unlucky. Un-stamp everything this run
        // has not genuinely processed, so the cursor does not advance over it.
        for (const rest of all.slice(index + 1)) unmarkDistilled.run(rest.id);
        result.backendFailed = true;
        break;
      }
      continue;
    }
    consecutiveFailures = 0;

    const memory_type = MEMORY_TYPES.has(obj.memory_type as string) ? obj.memory_type as MemoryType : m.memory_type;
    const scope = SCOPES.has(obj.scope as string) ? obj.scope as AtomScope : m.scope;
    const decay_class = DECAY_CLASSES.has(obj.decay_class as string) ? obj.decay_class as DecayClass : m.decay_class;
    const tags = Array.isArray(obj.tags)
      ? (obj.tags as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).toLowerCase()).slice(0, 5)
      : [];

    // Set-union in code — the model never carries identifiers across a merge.
    // Sourced from each cluster member's own `identifiers` column (populated at
    // insert time or by the Phase 1 backfill), not re-extracted from the LLM's
    // merged prose: that would only recover what the model happened to keep,
    // reproducing the exact loss this column exists to eliminate. See
    // src/core/identifiers.ts and _documents/design-structured-memory.md (Phase 1).
    const mergedIdentifiers = unionIdentifiers(...cluster.map(c => c.identifiers));

    const ins = insertMemory(db, {
      title: (obj.title as string).slice(0, 120),
      body: obj.body as string,
      memory_type,
      scope,
      project: m.project,
      confidence: Math.max(...cluster.map(c => c.confidence)),
      decay_class,
      review_status: 'approved',
      source_session_id: null,
      discovered_from: null,
      tags,
      load_at_init: cluster.some(c => c.load_at_init === 1),
      promotion_target: 'none',
      identifiers: mergedIdentifiers,
    });
    if (!ins.inserted) continue;
    await embedMemory(db, ins.id, embedFn);

    // Coverage gate — the last point at which this is still reversible. Superseding
    // is destructive, so a rewrite that drifted away from one of its sources would
    // delete that memory outright. Reject the merge and leave every original live.
    const shortfall = coverageShortfall(db, ins.id, cluster);
    if (shortfall !== null) {
      db.prepare(`DELETE FROM memories WHERE id = ?`).run(ins.id);
      result.rejected++;
      continue;
    }

    result.created++;
    for (const c of cluster) {
      supersede.run(ins.id, c.id);
      link.run(ins.id, c.id);
      result.merged++;
    }
  }

  // ── Sanitize verbose singletons ────────────────────────────────────
  // Re-read each memory's current state: skip any the merge step superseded.
  // Skipped entirely on backend failure — every call would fail the same way.
  for (const m of result.backendFailed ? [] : all) {
    const fresh = db.prepare(`SELECT superseded_by, body FROM memories WHERE id = ?`)
      .get(m.id) as { superseded_by: string | null; body: string } | undefined;
    if (!fresh || fresh.superseded_by) continue;
    if (fresh.body.length <= SANITIZE_OVER_CHARS) continue;

    const obj = firstJsonObject(await callFn(SANITIZE_PROMPT, `(${m.memory_type}) ${m.title}\n${fresh.body}`));
    if (!obj || typeof obj.body !== 'string' || obj.body.length >= fresh.body.length) continue;

    const newTitle = typeof obj.title === 'string' ? (obj.title as string).slice(0, 120) : m.title;
    // Sanitize rewrites body text, same as a merge — it must carry the same
    // identifier guarantee. Union `m.identifiers` (captured at insert/backfill
    // time, before this rewrite) with a fresh extraction of the tightened text,
    // rather than overwriting: whatever the shortened prose still names is
    // included, and nothing the pre-rewrite body named is ever dropped just
    // because this pass shortened it. Fixes the two identifier losses found in
    // the Phase 1 whole-population audit (ADR-20260808214308-a0) — both traced
    // to this UPDATE not touching `identifiers`, not to the extractor itself.
    const newIdentifiers = unionIdentifiers(m.identifiers, extractIdentifiers(`${newTitle}\n${obj.body}`));

    db.prepare(`UPDATE memories SET title = ?, body = ?, identifiers = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(newTitle, obj.body, JSON.stringify(newIdentifiers), m.id);
    await embedMemory(db, m.id, embedFn);
    result.sanitized++;
  }

  // Measured, not derived: rows this run marked are gone from the cursor's
  // candidate set, as are any the merge step superseded (including cluster
  // members pulled in from outside the pool). Newly created consolidations are
  // themselves un-examined and correctly counted back in. Strictly decreasing
  // while processed > 0, so a caller looping until 0 terminates.
  result.eligibleRemaining = countEligible(db, scope, since);

  return result;
}
