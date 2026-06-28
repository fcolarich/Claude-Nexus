/**
 * Memory data layer — CRUD, embedding, and similarity for the `memories` table.
 * The autonomous memory engine's store. Used by the Reflector (capture) and,
 * later, by recall.
 */
import Database from 'better-sqlite3';
import type { Memory, MemoryType, DecayClass, ReviewStatus, AtomScope } from './types.js';
export interface MemoryInput {
    title: string;
    body: string;
    memory_type: MemoryType;
    scope: AtomScope;
    project: string | null;
    confidence: number;
    decay_class: DecayClass;
    review_status: ReviewStatus;
    source_session_id: string | null;
    discovered_from: string | null;
    tags: string[];
    load_at_init?: boolean;
}
/** Content-addressed id — identical (type, body) collapses to one row. */
export declare function computeMemoryId(memory_type: string, body: string): string;
/**
 * Serialize a vector for a sqlite-vec BLOB column. better-sqlite3 will not bind
 * a Float32Array directly — it must be handed the raw bytes as a Buffer.
 */
export declare function vecToBlob(v: Float32Array): Buffer;
/** Unit-normalize a vector so L2 distance maps cleanly to cosine similarity. */
export declare function normalize(v: Float32Array): Float32Array;
/** Insert a memory. Returns inserted=false if the content-addressed id already exists. */
export declare function insertMemory(db: Database.Database, input: MemoryInput): {
    id: string;
    inserted: boolean;
};
export declare function getMemory(db: Database.Database, id: string): Memory | undefined;
export declare function listMemories(db: Database.Database, opts?: {
    review_status?: ReviewStatus;
    project?: string;
    memory_type?: MemoryType;
    scope?: AtomScope;
    includeSuperseded?: boolean;
    limit?: number;
}): Memory[];
/**
 * Reconfirm an existing memory — the Reflector saw it again this session.
 * Nudges confidence up and resets the decay clock.
 */
export declare function touchMemory(db: Database.Database, id: string): void;
/** Hard-delete a memory and its vector row. Returns false if the id was absent. */
export declare function deleteMemory(db: Database.Database, id: string): boolean;
/** Generate + store a normalized embedding for one memory. Returns false if embedding unavailable. */
export declare function embedMemory(db: Database.Database, id: string, embedFn?: (text: string) => Promise<Float32Array | null>): Promise<boolean>;
/** Embed every memory lacking a vector. Mirrors the atoms embedding pass. */
export declare function embedUnindexedMemories(db: Database.Database, embedFn?: (text: string) => Promise<Float32Array | null>): Promise<{
    embedded: number;
    skipped: number;
}>;
/** Reconfirm a memory — resets the decay clock and nudges confidence up. */
export declare function verifyMemory(db: Database.Database, id: string): boolean;
/** Record whether a recalled memory helped — feeds the help-rate ranking term. */
export declare function recordFeedback(db: Database.Database, id: string, helped: boolean): boolean;
/**
 * Find the most similar existing memory to a query vector (for dedup).
 * Expects a unit-normalized query vector; returns cosine similarity in [0,1].
 */
export declare function findSimilarMemory(db: Database.Database, queryVec: Float32Array, opts?: {
    scope?: AtomScope;
    project?: string | null;
    excludeId?: string;
    excludeSuperseded?: boolean;
    k?: number;
}): {
    memory: Memory;
    similarity: number;
} | null;
//# sourceMappingURL=memories.d.ts.map