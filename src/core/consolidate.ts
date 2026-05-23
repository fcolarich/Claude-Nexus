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
import type { AtomScope } from './types.js';
import { getNexusConfig } from './config.js';
import { generateEmbedding } from './embeddings.js';
import { embedUnindexedMemories, findSimilarMemory, normalize } from './memories.js';

export interface ConsolidateResult {
  embedded: number;   // memories given an embedding this run
  merged: number;     // near-duplicate pairs collapsed
  pruned: number;     // rejected memories deleted
}

export async function consolidateMemories(
  db: Database.Database,
  embedFn: (text: string) => Promise<Float32Array | null> = generateEmbedding
): Promise<ConsolidateResult> {
  const threshold = getNexusConfig().capture.dedup_cosine_threshold;

  // 1. Backfill embeddings.
  const { embedded } = await embedUnindexedMemories(db, embedFn);

  // 2. Prune rejected.
  const pruned = db.prepare(`DELETE FROM memories WHERE review_status = 'rejected'`).run().changes;

  // 3. Merge near-duplicates. Highest-confidence first so the survivor of each
  //    pair is the stronger memory.
  const live = db.prepare(`
    SELECT id, body, scope, project, confidence FROM memories
    WHERE superseded_by IS NULL
    ORDER BY confidence DESC, created_at ASC
  `).all() as { id: string; body: string; scope: AtomScope; project: string | null; confidence: number }[];

  const supersede = db.prepare(
    `UPDATE memories SET superseded_by = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const link = db.prepare(
    `INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence)
     VALUES (?, ?, 'duplicates', 1.0)`
  );

  const gone = new Set<string>();
  let merged = 0;

  for (const m of live) {
    if (gone.has(m.id)) continue;
    const vec = await embedFn(m.body);
    if (!vec) continue;

    const sim = findSimilarMemory(db, normalize(vec), {
      scope: m.scope,
      project: m.project,
      excludeId: m.id,
      excludeSuperseded: true,
    });
    if (!sim || sim.similarity < threshold || gone.has(sim.memory.id)) continue;

    const mWins = m.confidence >= sim.memory.confidence;
    const winnerId = mWins ? m.id : sim.memory.id;
    const loserId = mWins ? sim.memory.id : m.id;

    supersede.run(winnerId, loserId);
    link.run(winnerId, loserId);
    gone.add(loserId);
    merged++;
  }

  return { embedded, merged, pruned };
}
