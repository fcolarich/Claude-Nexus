/**
 * Consolidation (autoDream) — a periodic cleanup sweep over the memory store.
 *
 *  1. Ensures every memory has an embedding (legacy imports arrive without one).
 *  2. Prunes rejected memories — a human said no, so remove them.
 *  3. Merges near-duplicates: the lower-confidence memory of a similar pair is
 *     superseded by the higher-confidence one (kept in the DB as an audit trail,
 *     hidden from recall and export).
 *
 * Conservative by design: decayed memories are NEVER auto-deleted — they simply
 * fall out of recall and can be revived with verify. Only explicitly rejected
 * memories are pruned.
 */

import Database from 'better-sqlite3';
import type { AtomScope, MemoryType } from './types.js';
import { getNexusConfig } from './config.js';
import { generateEmbedding } from './embeddings.js';
import { embedUnindexedMemories, findSimilarMemory, normalize } from './memories.js';
import { governByHelpRate, detectContradictions, type HaikuFn } from './governance.js';
import { callModel } from './llm.js';
import { confirmMemoryDuplicate, type MemoryDuplicateVerdict } from './memory-dedup-confirm.js';

/**
 * Claim-level confirmation gate for the raw-cosine duplicate merge below (see
 * memory-dedup-confirm.ts's docstring for why raw cosine alone is risky).
 * Always runs — defaults to confirmMemoryDuplicate bound to this call's own
 * haikuFn, but stays injectable so tests can stub it.
 */
export type ConfirmDuplicateFn = (
  db: Database.Database,
  memoryA: { id: string; body: string; memory_type: MemoryType; confidence: number },
  memoryB: { id: string; body: string; memory_type: MemoryType; confidence: number },
) => Promise<MemoryDuplicateVerdict>;

export interface ConsolidateResult {
  embedded: number;   // memories given an embedding this run
  merged: number;     // near-duplicate pairs collapsed
  pruned: number;     // rejected memories deleted
  demoted: number;    // low help-rate memories demoted
  reinforced: number; // high help-rate memories reinforced
  contradictionsFlagged: number;      // memory pairs confirmed as contradicting
  contradictionPairsChecked: number;  // candidate pairs sent to the LLM
}

/**
 * Q4 REWRITE NO-GO — LLM body-compaction/rewrite evaluated and declined.
 *
 * Rationale:
 *   1. Volume: embed + prune-rejected + merge-by-supersede (steps below) is
 *      sufficient at current per-bucket memory volume. A full-corpus LLM
 *      rewrite pass would add latency and API cost with no measurable quality
 *      gain at this scale.
 *
 *   2. Index bloat: downstream MEMORY.md bloat is addressed by the per-bucket
 *      item cap in export.ts (capture.memory_md_max_items), not by rewriting
 *      bodies. Rewriting bodies to shrink the export is the wrong layer.
 *
 *   3. Provenance: no schema column exists to record that a body was
 *      LLM-rewritten (e.g. a rewrite_source / rewrite_version field). Without
 *      provenance, a rewritten body is indistinguishable from an extraction
 *      artefact — this breaks audit and rollback. Adding the schema is
 *      deferred; revisit when volume forces the issue.
 *
 * Decision: do NOT add LLM rewrite logic here. The three reasons above must
 * each be addressed before this decision can be reversed.
 */
export async function consolidateMemories(
  db: Database.Database,
  embedFn: (text: string) => Promise<Float32Array | null> = generateEmbedding,
  haikuFn: HaikuFn = callModel,
  confirmDuplicateFn: ConfirmDuplicateFn = (db, a, b) => confirmMemoryDuplicate(db, a, b, haikuFn)
): Promise<ConsolidateResult> {
  const threshold = getNexusConfig().capture.dedup_cosine_threshold;

  // 1. Backfill embeddings.
  const { embedded } = await embedUnindexedMemories(db, embedFn);

  // 2. Prune rejected.
  const pruned = db.prepare(`DELETE FROM memories WHERE review_status = 'rejected'`).run().changes;

  // 3. Merge near-duplicates. Highest-confidence first so the survivor of each
  //    pair is the stronger memory.
  const live = db.prepare(`
    SELECT id, body, scope, project, confidence, memory_type FROM memories
    WHERE superseded_by IS NULL
    ORDER BY confidence DESC, created_at ASC
  `).all() as { id: string; body: string; scope: AtomScope; project: string | null; confidence: number; memory_type: MemoryType }[];

  const supersede = db.prepare(
    `UPDATE memories SET superseded_by = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const link = db.prepare(
    `INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence)
     VALUES (?, ?, 'duplicates', 1.0)`
  );

  // Pre-load all cached vectors from memories_vec (rowid → Float32Array).
  // Avoids re-calling the embedding model for memories that already have vectors.
  const cachedVecs = new Map<string, Float32Array>();
  const vecRows = db.prepare(`
    SELECT m.id, mv.embedding
    FROM memories m
    JOIN memories_vec mv ON mv.rowid = m.rowid
    WHERE m.superseded_by IS NULL
  `).all() as { id: string; embedding: Buffer }[];
  for (const row of vecRows) {
    cachedVecs.set(row.id, new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
  }

  const gone = new Set<string>();
  let merged = 0;

  for (const m of live) {
    if (gone.has(m.id)) continue;
    const cached = cachedVecs.get(m.id);
    const vec = cached ?? await embedFn(m.body);
    if (!vec) continue;
    const normVec = cached ? vec : normalize(vec); // cached vectors are already normalized

    const sim = findSimilarMemory(db, normVec, {
      scope: m.scope,
      project: m.project,
      excludeId: m.id,
      excludeSuperseded: true,
    });
    if (!sim || sim.similarity < threshold || gone.has(sim.memory.id)) continue;

    const verdict = await confirmDuplicateFn(
      db,
      { id: m.id, body: m.body, memory_type: m.memory_type, confidence: m.confidence },
      { id: sim.memory.id, body: sim.memory.body, memory_type: sim.memory.memory_type, confidence: sim.memory.confidence },
    );
    if (verdict !== 'confirmed') continue; // raw cosine similarity alone was not enough — skip, do not supersede

    const mWins = m.confidence >= sim.memory.confidence;
    const winnerId = mWins ? m.id : sim.memory.id;
    const loserId = mWins ? sim.memory.id : m.id;

    supersede.run(winnerId, loserId);
    link.run(winnerId, loserId);
    gone.add(loserId);
    merged++;
  }

  // 4. Govern by help-rate: demote low performers, reinforce high performers.
  const { demoted, reinforced } = governByHelpRate(db);

  // 5. Detect contradictions among 'related' pairs (gated behind DDR-005).
  const { contradictionsFlagged, contradictionPairsChecked } = await detectContradictions(db, haikuFn);

  return { embedded, merged, pruned, demoted, reinforced, contradictionsFlagged, contradictionPairsChecked };
}
