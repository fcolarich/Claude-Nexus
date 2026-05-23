/**
 * Hybrid linking core — BM25 + dense KNN merged via Reciprocal Rank Fusion.
 * Called by the indexer (linkAtom) and reflector (linkMemory) after each embed.
 */
import Database from 'better-sqlite3';
import BM25 from 'wink-bm25-text-search';
import type { LinkType } from './types.js';
export type Bm25Index = ReturnType<typeof BM25>;
export interface RankedResult {
    id: string;
    score: number;
}
/**
 * Build a wink-bm25 index from a list of atoms/memories.
 * Needs ≥ 3 docs to consolidate successfully.
 */
export declare function buildBm25Corpus(docs: {
    id: string;
    title: string;
    body: string;
}[]): Bm25Index;
/**
 * Standard RRF rank merge. score += 1/(K + rank) for each list.
 * rank is 1-indexed. Returns top topK items sorted descending by merged score.
 */
export declare function rrfMerge(bm25Results: RankedResult[], denseResults: RankedResult[], topK?: number, K?: number): RankedResult[];
/**
 * Upsert a bidirectional link between two nodes. Skips self-links.
 * table: 'atom_links' links atoms; 'memory_links' links memories/atoms.
 */
export declare function upsertLink(db: Database.Database, sourceId: string, targetId: string, linkType: LinkType, confidence: number, table?: 'atom_links' | 'memory_links'): void;
/**
 * Hybrid-link a single atom against the corpus.
 * Skips if linked_at > updated_at (already current).
 * Updates atoms.linked_at after processing.
 */
export declare function linkAtom(db: Database.Database, atomId: string, embedFn: (text: string) => Promise<Float32Array | null>, corpus?: Bm25Index): Promise<void>;
/**
 * Hybrid-link a single memory against the corpus.
 * Skips if linked_at > updated_at.
 * Updates memories.linked_at after processing.
 */
export declare function linkMemory(db: Database.Database, memoryId: string, embedFn: (text: string) => Promise<Float32Array | null>, corpus?: Bm25Index): Promise<void>;
//# sourceMappingURL=links.d.ts.map