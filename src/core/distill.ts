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
import { getNexusConfig } from './config.js';
import { generateEmbedding } from './embeddings.js';
import { callModel } from './llm.js';
import { embedUnindexedMemories, insertMemory, embedMemory, normalize } from './memories.js';
import { resolveProjectSlug } from './project-root.js';
import type { Memory, MemoryType, DecayClass, AtomScope } from './types.js';

const BAND_LOW = 0.70;        // below: unrelated. at/above dedup threshold: consolidate's job.
const MAX_CLUSTER = 8;
const SANITIZE_OVER_CHARS = 800;

const MEMORY_TYPES = new Set(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']);
const DECAY_CLASSES = new Set(['stable', 'architecture', 'api_contract', 'implementation']);
const SCOPES = new Set(['global', 'shared', 'project']);

export interface DistillOptions {
  project?: string;   // project slug to scope to; literal "global" targets the global bucket
  cwd?: string;        // derive project slug when project is omitted (same helper as nexus_backfill)
  limit?: number;      // max candidate memories pulled into the clustering pool (default 200, hard cap 500)
  dryRun?: boolean;    // count eligibility only; never call callFn or embedFn
}

export interface DistillResult {
  embedded: number;   // memories embedded before distilling
  clusters: number;   // related-memory clusters found
  merged: number;     // original memories folded into a consolidation
  created: number;    // new consolidated memories written
  sanitized: number;  // verbose singletons tightened in place
  processed: number;          // candidate memories considered this run (<= limit)
  eligibleRemaining: number;  // eligible memories under this scope NOT covered by this run
  scope: string;              // resolved scope label: project slug, "global", or "all"
  dryRun: boolean;
}

const MERGE_PROMPT = `You consolidate related memories into one.

Given several memories about overlapping topics, write a SINGLE memory that captures every distinct fact and rationale from all of them — tighter, clearer, no redundancy. Keep the most specific information; drop nothing that matters.

Output STRICT JSON ONLY, one object:
{"title": "...", "body": "...", "memory_type": "...", "scope": "...", "decay_class": "...", "tags": ["..."]}

memory_type: preference|convention|failure|correction|decision|insight|tool_quirk|reference|handoff
scope: project|global|shared
decay_class: stable|architecture|api_contract|implementation
body: 1-4 self-contained sentences. No prose or fences outside the JSON.`;

const SANITIZE_PROMPT = `Tighten this memory. Remove redundancy and filler; keep every distinct fact and the reasoning. Do not add anything.

Output STRICT JSON ONLY: {"title": "...", "body": "..."}  No prose or fences.`;

// Exported for unit testing only — not part of the public distill.ts contract
// (distillMemories/DistillOptions/DistillResult remain the only intended external surface).
export type ResolvedScope = { kind: 'project'; slug: string } | { kind: 'global' } | { kind: 'all' };

/**
 * Maps DistillOptions -> ResolvedScope. `project` wins over `cwd`; literal
 * `project: "global"` targets the global bucket. `cwd` derives a slug via the
 * same helper nexus_backfill uses; an unresolvable cwd degrades to "all"
 * (never throws — a slug with no matching rows is just an empty-scope run).
 */
export function resolveScope(opts: DistillOptions | undefined): ResolvedScope {
  if (opts?.project) {
    return opts.project === 'global' ? { kind: 'global' } : { kind: 'project', slug: opts.project };
  }
  if (opts?.cwd) {
    const slug = resolveProjectSlug(opts.cwd);
    if (slug) return { kind: 'project', slug };
  }
  return { kind: 'all' };
}

/** Pure SQL builder over the scope filter. Appends LIMIT :limit — countEligible never does. */
export function buildEligibleQuery(scope: ResolvedScope, limit: number): { sql: string; params: Record<string, unknown> } {
  if (scope.kind === 'project') {
    return {
      sql: `SELECT * FROM memories WHERE project = :slug AND scope != 'global' AND superseded_by IS NULL AND review_status != 'rejected' ORDER BY confidence DESC, created_at ASC LIMIT :limit`,
      params: { slug: scope.slug, limit },
    };
  }
  if (scope.kind === 'global') {
    return {
      sql: `SELECT * FROM memories WHERE scope = 'global' AND superseded_by IS NULL AND review_status != 'rejected' ORDER BY confidence DESC, created_at ASC LIMIT :limit`,
      params: { limit },
    };
  }
  return {
    sql: `SELECT * FROM memories WHERE superseded_by IS NULL AND review_status != 'rejected' ORDER BY confidence DESC, created_at ASC LIMIT :limit`,
    params: { limit },
  };
}

/** Count of eligible rows under scope — same filter as buildEligibleQuery, no LIMIT. */
export function countEligible(db: Database.Database, scope: ResolvedScope): number {
  if (scope.kind === 'project') {
    return (db.prepare(
      `SELECT COUNT(*) c FROM memories WHERE project = :slug AND scope != 'global' AND superseded_by IS NULL AND review_status != 'rejected'`
    ).get({ slug: scope.slug }) as { c: number }).c;
  }
  if (scope.kind === 'global') {
    return (db.prepare(
      `SELECT COUNT(*) c FROM memories WHERE scope = 'global' AND superseded_by IS NULL AND review_status != 'rejected'`
    ).get() as { c: number }).c;
  }
  return (db.prepare(
    `SELECT COUNT(*) c FROM memories WHERE superseded_by IS NULL AND review_status != 'rejected'`
  ).get() as { c: number }).c;
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
  return { ...(r as unknown as Memory), tags: JSON.parse((r.tags as string) || '[]') };
}

function firstJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { parsed = JSON.parse(m[0]); } catch { return null; }
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
  const scope = resolveScope(opts);

  if (opts?.dryRun) {
    const countEligibleSnapshot = countEligible(db, scope);
    const processed = Math.min(countEligibleSnapshot, clampedLimit);
    return {
      embedded: 0, clusters: 0, merged: 0, created: 0, sanitized: 0,
      processed,
      eligibleRemaining: countEligibleSnapshot - processed,
      scope: scopeLabel(scope),
      dryRun: true,
    };
  }

  const dedupThreshold = getNexusConfig().capture.dedup_cosine_threshold;
  const { embedded } = await embedUnindexedMemories(db, embedFn);

  const { sql, params } = buildEligibleQuery(scope, clampedLimit);
  const all = (db.prepare(sql).all(params) as Record<string, unknown>[]).map(rowToMemory);
  const countEligibleSnapshot = countEligible(db, scope);

  const assigned = new Set<string>();
  const result: DistillResult = {
    embedded, clusters: 0, merged: 0, created: 0, sanitized: 0,
    processed: all.length,
    eligibleRemaining: Math.max(0, countEligibleSnapshot - all.length),
    scope: scopeLabel(scope),
    dryRun: false,
  };

  const supersede = db.prepare(`UPDATE memories SET superseded_by = ?, updated_at = datetime('now') WHERE id = ?`);
  const link = db.prepare(
    `INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence) VALUES (?, ?, 'refines', 1.0)`
  );

  // ── Cluster + merge ────────────────────────────────────────────────
  for (const m of all) {
    if (assigned.has(m.id)) continue;
    // Prefer the vector already sitting in memories_vec (stored by
    // embedUnindexedMemories above, or an earlier run) — only pay for a fresh
    // Ollama call on an actual miss (rare, post-embedUnindexedMemories).
    const rowidRow = db.prepare(`SELECT rowid FROM memories WHERE id = ?`).get(m.id) as { rowid: number } | undefined;
    const stored = rowidRow ? loadStoredVector(db, rowidRow.rowid) : null;
    const vec = stored ?? await embedFn(m.body);
    if (!vec) { assigned.add(m.id); continue; }

    const related = relatedMemories(db, normalize(vec), m, dedupThreshold)
      .filter(r => !assigned.has(r.memory.id));
    if (related.length === 0) { assigned.add(m.id); continue; }

    const cluster = [m, ...related.map(r => r.memory)].slice(0, MAX_CLUSTER);
    for (const c of cluster) assigned.add(c.id);
    result.clusters++;

    const listing = cluster
      .map((c, i) => `[${i + 1}] (${c.memory_type}) ${c.title}\n${c.body}`)
      .join('\n\n');
    const obj = firstJsonObject(await callFn(MERGE_PROMPT, listing));
    if (!obj || typeof obj.title !== 'string' || typeof obj.body !== 'string') continue;

    const memory_type = MEMORY_TYPES.has(obj.memory_type as string) ? obj.memory_type as MemoryType : m.memory_type;
    const scope = SCOPES.has(obj.scope as string) ? obj.scope as AtomScope : m.scope;
    const decay_class = DECAY_CLASSES.has(obj.decay_class as string) ? obj.decay_class as DecayClass : m.decay_class;
    const tags = Array.isArray(obj.tags)
      ? (obj.tags as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).toLowerCase()).slice(0, 5)
      : [];

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
    });
    if (!ins.inserted) continue;
    result.created++;
    await embedMemory(db, ins.id, embedFn);

    for (const c of cluster) {
      supersede.run(ins.id, c.id);
      link.run(ins.id, c.id);
      result.merged++;
    }
  }

  // ── Sanitize verbose singletons ────────────────────────────────────
  // Re-read each memory's current state: skip any the merge step superseded.
  for (const m of all) {
    const fresh = db.prepare(`SELECT superseded_by, body FROM memories WHERE id = ?`)
      .get(m.id) as { superseded_by: string | null; body: string } | undefined;
    if (!fresh || fresh.superseded_by) continue;
    if (fresh.body.length <= SANITIZE_OVER_CHARS) continue;

    const obj = firstJsonObject(await callFn(SANITIZE_PROMPT, `(${m.memory_type}) ${m.title}\n${fresh.body}`));
    if (!obj || typeof obj.body !== 'string' || obj.body.length >= fresh.body.length) continue;

    db.prepare(`UPDATE memories SET title = ?, body = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(typeof obj.title === 'string' ? (obj.title as string).slice(0, 120) : m.title, obj.body, m.id);
    await embedMemory(db, m.id, embedFn);
    result.sanitized++;
  }

  return result;
}
