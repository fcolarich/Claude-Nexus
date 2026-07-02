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
 * Prompt-driven recall: rank memories by vector cosine similarity to a query,
 * keep only those above a relevance floor, exclude a caller-supplied id set
 * (per-session dedup), and return the top `limit`. Falls back to FTS5 only when
 * no embedding is available or the corpus has no vectors — never bypasses the
 * floor on an embedded corpus.
 *
 * When the local cross-encoder reranker is available, KNN candidates are
 * reranked against the query and floored on rerank score instead of cosine
 * similarity — a cross-encoder catches conceptually-relevant matches cosine
 * misses, and drops near-duplicates cosine over-ranks. If the reranker is
 * disabled or unreachable, this falls back to the cosine-floor path unchanged.
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