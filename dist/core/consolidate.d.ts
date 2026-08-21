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
import type { MemoryType } from './types.js';
import { type HaikuFn } from './governance.js';
import { type MemoryDuplicateVerdict } from './memory-dedup-confirm.js';
/**
 * Claim-level confirmation gate for the raw-cosine duplicate merge below (see
 * memory-dedup-confirm.ts's docstring for why raw cosine alone is risky).
 * Always runs — defaults to confirmMemoryDuplicate bound to this call's own
 * haikuFn, but stays injectable so tests can stub it.
 */
export type ConfirmDuplicateFn = (db: Database.Database, memoryA: {
    id: string;
    body: string;
    memory_type: MemoryType;
    confidence: number;
}, memoryB: {
    id: string;
    body: string;
    memory_type: MemoryType;
    confidence: number;
}) => Promise<MemoryDuplicateVerdict>;
export interface ConsolidateResult {
    embedded: number;
    merged: number;
    pruned: number;
    demoted: number;
    reinforced: number;
    contradictionsFlagged: number;
    contradictionPairsChecked: number;
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
export declare function consolidateMemories(db: Database.Database, embedFn?: (text: string) => Promise<Float32Array | null>, haikuFn?: HaikuFn, confirmDuplicateFn?: ConfirmDuplicateFn): Promise<ConsolidateResult>;
//# sourceMappingURL=consolidate.d.ts.map