/**
 * Recall — budgeted retrieval of memories for injection into a session.
 *
 * Ranks approved memories by effective-confidence x help-rate, pins
 * load_at_init memories, then walks a token budget: full bodies until the
 * budget is reached, titles-only thereafter. Pure read — no mutation, no
 * network — so it is cheap enough for the SessionStart hot path.
 */
import Database from 'better-sqlite3';
import { rerank as rerankDocuments } from './reranker.js';
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
    total: number;
}
/** Exported only for tests — do not call from production code. */
export declare const estTokensForTest: (s: string) => number;
/**
 * Recall memories for a project. With no query, returns the project's most
 * relevant memories for session-start injection. With a query, restricts to
 * FTS matches first, then ranks.
 */
export declare function recallMemories(db: Database.Database, opts: {
    project?: string | null;
    query?: string;
    maxTokens?: number;
}): RecallResult;
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
export declare function recallByQuery(db: Database.Database, opts: {
    project?: string | null;
    query: string;
    limit?: number;
    minSimilarity?: number;
    excludeIds?: string[];
    rerankFn?: typeof rerankDocuments;
}): Promise<RecallResult>;
//# sourceMappingURL=recall.d.ts.map