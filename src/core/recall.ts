/**
 * Recall — budgeted retrieval of memories for injection into a session.
 *
 * Ranks approved memories by effective-confidence x help-rate, pins
 * load_at_init memories, then walks a token budget: full bodies until the
 * budget is reached, titles-only thereafter. Pure read — no mutation, no
 * network — so it is cheap enough for the SessionStart hot path.
 */

import Database from 'better-sqlite3';
import { encode } from 'gpt-tokenizer';
import { getNexusConfig } from './config.js';
import { sanitizeFts5Query } from './search.js';
import { effectiveConfidence } from './decay.js';
import { generateEmbedding } from './embeddings.js';
import { rerank as rerankDocuments } from './reranker.js';
import { normalize } from './memories.js';
import { rrfFuse } from './rrf.js';
import type { Memory } from './types.js';

export interface RecalledItem {
  memory: Memory;
  score: number;
  mode: 'full' | 'title';
}

export interface RecallResult {
  items: RecalledItem[];
  markdown: string;
  tokenEstimate: number;
  total: number;        // candidates considered before the budget walk
}

const _tokenMemo = new Map<string, number>();

const estTokens = (s: string): number => {
  if (s.length === 0) return 0;
  const cached = _tokenMemo.get(s);
  if (cached !== undefined) return cached;
  let count: number;
  try {
    count = encode(s).length;
  } catch {
    count = Math.ceil(s.length / 4);
  }
  _tokenMemo.set(s, count);
  return count;
};

/** Exported only for tests — do not call from production code. */
export const estTokensForTest = estTokens;

function rowToMemory(r: Record<string, unknown>): Memory {
  return { ...(r as unknown as Memory), tags: JSON.parse((r.tags as string) || '[]') };
}

function scoreMemory(m: Memory): number {
  const helpRate = m.use_count > 0
    ? Math.max(0.5, Math.min(1.5, 0.5 + m.help_count / m.use_count))
    : 1.0;
  return effectiveConfidence(m) * helpRate;
}

function renderFull(m: Memory): string {
  const badge = m.scope === 'global' ? ' [GLOBAL]' : m.scope === 'shared' ? ' [SHARED]' : '';
  return `## [${m.memory_type}] ${m.title}${badge}\n${m.body}\n`;
}

function titleLine(m: Memory): string {
  return `- [${m.memory_type}] ${m.title}`;
}

/**
 * Recall memories for a project. With no query, returns the project's most
 * relevant memories for session-start injection. With a query, restricts to
 * FTS matches first, then ranks.
 */
export function recallMemories(
  db: Database.Database,
  opts: { project?: string | null; query?: string; maxTokens?: number }
): RecallResult {
  const empty: RecallResult = { items: [], markdown: '', tokenEstimate: 0, total: 0 };

  // memories table is absent on a pre-v2 database
  const exists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`
  ).get();
  if (!exists) return empty;

  const cfg = getNexusConfig().recall;
  const maxTokens = opts.maxTokens ?? cfg.max_tokens;
  const project = opts.project ?? '';

  // Dual-bank: project-scoped memories + global/shared memories.
  const scopeClause = `(m.scope IN ('global','shared') OR (m.scope='project' AND m.project = @project))`;

  let rows: Record<string, unknown>[];
  if (opts.query && opts.query.trim()) {
    rows = db.prepare(`
      SELECT m.* FROM memories_fts f
      JOIN memories m ON m.rowid = f.rowid
      WHERE memories_fts MATCH @q
        AND m.review_status = 'approved' AND m.superseded_by IS NULL
        AND ${scopeClause}
    `).all({ q: sanitizeFts5Query(opts.query), project }) as Record<string, unknown>[];
  } else {
    rows = db.prepare(`
      SELECT m.* FROM memories m
      WHERE m.review_status = 'approved' AND m.superseded_by IS NULL
        AND ${scopeClause}
    `).all({ project }) as Record<string, unknown>[];
  }

  // Eligibility: effective (decayed) confidence must clear the threshold,
  // unless the memory is explicitly pinned for session-init loading.
  const eligible = rows
    .map(rowToMemory)
    .filter(m => m.load_at_init === 1 || effectiveConfidence(m) >= cfg.min_confidence);
  if (eligible.length === 0) return empty;

  // Rank: load_at_init pinned first, then by score.
  const scored = eligible.map(m => ({ m, score: scoreMemory(m) }));
  scored.sort((a, b) => {
    if (a.m.load_at_init !== b.m.load_at_init) return b.m.load_at_init - a.m.load_at_init;
    return b.score - a.score;
  });

  // Budget walk: full bodies until the budget is hit, titles-only after.
  const HEADER = '# Recalled Memory\n';
  let used = estTokens(HEADER);
  let overflowed = false;
  const items: RecalledItem[] = [];

  for (const { m, score } of scored) {
    if (!overflowed) {
      const cost = estTokens(renderFull(m));
      if (m.load_at_init || used + cost <= maxTokens) {
        items.push({ memory: m, score, mode: 'full' });
        used += cost;
        continue;
      }
      overflowed = true;
    }
    items.push({ memory: m, score, mode: 'title' });
    used += estTokens(titleLine(m) + '\n');
  }

  // Render
  const fullItems = items.filter(i => i.mode === 'full');
  const titleItems = items.filter(i => i.mode === 'title');
  const parts: string[] = [HEADER.trim()];
  for (const i of fullItems) parts.push(renderFull(i.memory).trim());
  if (titleItems.length > 0) {
    // Cap the titles-only overflow — without this every eligible memory (thousands)
    // is dumped at SessionStart, bloating the injection to >100KB. Show the top-N
    // by score (already sorted) and note how many were elided.
    const shown = titleItems.slice(0, cfg.max_title_items);
    const elided = titleItems.length - shown.length;
    parts.push('## More memories (titles only — recall budget reached)');
    parts.push(shown.map(i => titleLine(i.memory)).join('\n'));
    if (elided > 0) {
      parts.push(`_…and ${elided} more lower-ranked memories not shown. Use nexus_search to query them._`);
    }
  }
  const markdown = parts.join('\n\n');

  return { items, markdown, tokenEstimate: estTokens(markdown), total: eligible.length };
}

/**
 * Prompt-driven recall: fuses FTS5 keyword results and vector KNN results via
 * Reciprocal Rank Fusion, drops excluded ids, applies the minSimilarity cosine
 * floor to vector-originated candidates only (FTS5-matched ids bypass the floor
 * so fusion is not undone — see spec § "Floor vs FTS5"), optionally reranks the
 * bounded fused set with a cross-encoder, and returns the top `limit` memories.
 *
 * Pool sizes: FTS5 limit*3, vector limit*6. Rerank input bounded to ~limit*3.
 * If the reranker throws or is disabled, falls back to RRF-fused order.
 */
export async function recallByQuery(
  db: Database.Database,
  opts: {
    project?: string | null; query: string; limit?: number; minSimilarity?: number;
    excludeIds?: string[]; rerankFn?: typeof rerankDocuments;
  }
): Promise<RecallResult> {
  const empty: RecallResult = { items: [], markdown: '', tokenEstimate: 0, total: 0 };

  const memoriesExist = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`
  ).get();
  if (!memoriesExist) return empty;

  const cfg = getNexusConfig().recall;
  const rerankerCfg = getNexusConfig().reranker;
  const limit = opts.limit ?? 5;
  const minSimilarity = opts.minSimilarity ?? cfg.min_similarity;
  const project = opts.project ?? '';
  const exclude = new Set(opts.excludeIds ?? []);
  const scopeClause = `(m.scope IN ('global','shared') OR (m.scope='project' AND m.project = @project))`;
  const doRerank = opts.rerankFn ?? rerankDocuments;

  // ── FTS5 pool (limit*3) ──────────────────────────────────────────────────────
  const ftsRowids: number[] = [];
  const sanitizedQ = sanitizeFts5Query(opts.query);
  if (sanitizedQ) {
    const ftsRows = db.prepare(`
      SELECT m.rowid FROM memories_fts f
      JOIN memories m ON m.rowid = f.rowid
      WHERE memories_fts MATCH @q
        AND m.review_status = 'approved' AND m.superseded_by IS NULL
        AND ${scopeClause}
      ORDER BY f.rank
      LIMIT @lim
    `).all({ q: sanitizedQ, project, lim: limit * 3 }) as { rowid: number }[];
    for (const r of ftsRows) ftsRowids.push(r.rowid);
  }
  const ftsSet = new Set(ftsRowids);

  // ── Vector KNN pool (limit*6) ────────────────────────────────────────────────
  const vecRowids: number[] = [];
  const vecSimMap = new Map<number, number>(); // rowid → cosine similarity
  const vecMemMap = new Map<number, Memory>();  // rowid → hydrated Memory (pre-loaded)

  const queryVec = await generateEmbedding(opts.query);
  const vecTable = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'`
  ).get();

  if (queryVec && vecTable) {
    const norm = normalize(queryVec);
    let rows: { rowid: number; distance: number }[] = [];
    try {
      rows = db.prepare(`
        SELECT rowid, distance FROM memories_vec
        WHERE embedding MATCH json(@v)
        ORDER BY distance
        LIMIT @k
      `).all({ v: JSON.stringify(Array.from(norm)), k: Math.max(limit * 6, 30) }) as { rowid: number; distance: number }[];
    } catch { rows = []; }

    for (const r of rows) {
      const row = db.prepare(`
        SELECT m.* FROM memories m
        WHERE m.rowid = @rowid
          AND m.review_status = 'approved' AND m.superseded_by IS NULL
          AND ${scopeClause}
      `).get({ rowid: r.rowid, project }) as Record<string, unknown> | undefined;
      if (!row) continue;
      const m = rowToMemory(row);
      // Stored vectors are unit-normalised: cosine similarity = 1 - d²/2
      const sim = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
      vecRowids.push(r.rowid);
      vecSimMap.set(r.rowid, sim);
      vecMemMap.set(r.rowid, m);
    }
  }

  // ── RRF fusion (FTS5 list first, vector list second) ────────────────────────
  const fused = rrfFuse([ftsRowids, vecRowids]);

  // ── Hydrate, drop excludeIds, apply floor ────────────────────────────────────
  // minSimilarity floor applies only to vector-originated candidates; FTS5-matched
  // ids bypass the floor entirely — re-applying the floor after fusion would undo
  // the rescue of keyword-exact hits (spec § "Floor vs FTS5").
  const hydrateStmt = db.prepare(`
    SELECT m.* FROM memories m
    WHERE m.rowid = @rowid
      AND m.review_status = 'approved' AND m.superseded_by IS NULL
      AND ${scopeClause}
  `);
  const hydrated: { m: Memory; rrfScore: number }[] = [];

  for (const { id: rowid, score: rrfScore } of fused) {
    const mFromVec = vecMemMap.get(rowid);
    let m: Memory;
    if (mFromVec) {
      m = mFromVec;
    } else {
      const row = hydrateStmt.get({ rowid, project }) as Record<string, unknown> | undefined;
      if (!row) continue;
      m = rowToMemory(row);
    }
    if (exclude.has(m.id)) continue;
    // Vector-only candidates must clear the cosine floor
    if (!ftsSet.has(rowid)) {
      const sim = vecSimMap.get(rowid) ?? 0;
      if (sim < minSimilarity) continue;
    }
    hydrated.push({ m, rrfScore });
  }

  if (hydrated.length === 0) return empty;

  // ── Rerank bounded fused set ─────────────────────────────────────────────────
  // task-011 latency spot-check (SC-6): measured doRerank() wall-clock time against
  // the live jina-reranker-v2-base-multilingual daemon (127.0.0.1:8931), 3-5 warm
  // calls per size, sweeping candidate count:
  //   N=1: ~31ms   N=3: ~72ms   N=4: ~96ms   N=5: ~110ms
  //   N=8: ~169ms  N=10: ~232ms N=15: ~348ms (the original limit*3 bound at limit=5)
  // The original `limit*3` bound (15 candidates at the default limit=5) measured
  // ~350ms — over 3x the 100ms envelope ceiling. Rather than shrinking the whole
  // candidate pool (which would also shrink the non-reranked fallback below
  // `limit`), only the network call is capped: the RRF-fused pool keeps its full
  // breadth (~limit*3) for output purposes, but just the head (RERANK_INPUT_CAP=3,
  // ~72ms avg, comfortable margin below 100ms — N=4 was already borderline at
  // ~96ms with one sample at 114ms) is sent to the reranker. The unsent tail keeps
  // its RRF-fused order and is appended after the reranked head. Revisit if the
  // local daemon is swapped for a faster backend, or if reranking only the top 3
  // proves too shallow in practice.
  const bounded = hydrated.slice(0, limit * 3);
  const RERANK_INPUT_CAP = 3;
  const rerankHead = bounded.slice(0, RERANK_INPUT_CAP);
  const rerankTail = bounded.slice(RERANK_INPUT_CAP);
  const useReranker = rerankerCfg.enabled || opts.rerankFn !== undefined;
  let reranked: { m: Memory; score: number }[] | null = null;

  if (useReranker && rerankHead.length >= 1) {
    try {
      const rrResult = await doRerank(opts.query, rerankHead.map(c => c.m.body), rerankerCfg.threshold);
      if (rrResult && rrResult.length > 0) {
        reranked = [
          ...rrResult.map(r => ({ m: rerankHead[r.index].m, score: r.score })),
          ...rerankTail.map(c => ({ m: c.m, score: c.rrfScore })),
        ];
      }
    } catch { /* reranker unavailable — fall back to fused order */ }
  }

  const finalCandidates = reranked ?? bounded.map(c => ({ m: c.m, score: c.rrfScore }));
  const top = finalCandidates.slice(0, limit);

  const items: RecalledItem[] = top.map(({ m, score }) => ({ memory: m, score, mode: 'full' as const }));
  const HEADER = '# Recalled Memory\n';
  const parts: string[] = [HEADER.trim()];
  for (const i of items) parts.push(renderFull(i.memory).trim());
  const markdown = parts.join('\n\n');

  return { items, markdown, tokenEstimate: estTokens(markdown), total: hydrated.length };
}
