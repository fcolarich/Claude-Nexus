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
export interface ConsolidateResult {
    embedded: number;
    merged: number;
    pruned: number;
}
export declare function consolidateMemories(db: Database.Database, embedFn?: (text: string) => Promise<Float32Array | null>): Promise<ConsolidateResult>;
//# sourceMappingURL=consolidate.d.ts.map