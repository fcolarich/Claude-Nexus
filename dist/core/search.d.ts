import Database from 'better-sqlite3';
import type { Atom, AtomLink, SearchResult, Diagnostic, Session, Memory } from './types.js';
import { type GrepMatch, type GrepOptions } from './text-search.js';
export interface MemorySearchResult {
    memory: Memory;
    rank: number;
    snippet: string;
}
/**
 * Sanitize a query for FTS5 MATCH. Wraps each token in double quotes
 * to prevent special characters from crashing the query parser.
 * Passes through explicit FTS5 operators (AND, OR, NOT) and quoted phrases.
 */
export declare function sanitizeFts5Query(raw: string): string;
/**
 * Full-text search across all atoms using FTS5 BM25 ranking.
 */
export declare function search(db: Database.Database, query: string, options?: {
    project?: string;
    type?: string;
    scope?: string;
    limit?: number;
}): SearchResult[];
/**
 * Hybrid search: FTS5 BM25 + vector cosine via sqlite-vec, fused with Reciprocal Rank Fusion.
 * Falls back to FTS5-only search if Ollama is unavailable or atoms_vec does not exist.
 */
export declare function hybridSearch(db: Database.Database, query: string, options?: {
    project?: string;
    type?: string;
    scope?: string;
    limit?: number;
}): Promise<SearchResult[]>;
/**
 * FTS5 search over the memories table (approved, non-superseded).
 */
export declare function searchMemories(db: Database.Database, query: string, options?: {
    project?: string;
    scope?: string;
    limit?: number;
}): MemorySearchResult[];
/**
 * Hybrid (FTS5 + vector) search over memories, fused with RRF.
 * Falls back to FTS5-only if Ollama is unavailable or memories_vec does not exist.
 */
export declare function hybridSearchMemories(db: Database.Database, query: string, options?: {
    project?: string;
    scope?: string;
    limit?: number;
}): Promise<MemorySearchResult[]>;
/**
 * Multi-topic smart fetch over the memories table.
 */
export declare function fetchMemoryContext(db: Database.Database, topics: string[], options?: {
    project?: string;
}): string | null;
/**
 * "Smart fetch" — search for multiple topics and merge results into one markdown block.
 * This is the key MCP optimization: one tool call, all relevant context.
 */
export declare function fetchContext(db: Database.Database, topics: string[], options?: {
    project?: string;
    maxTokensEstimate?: number;
}): string | null;
/**
 * Get shared/global knowledge for session start.
 * Returns full content for atoms flagged load_at_init=true,
 * plus a compact titles-only index for all others.
 */
export declare function getSharedKnowledge(db: Database.Database): string | null;
/**
 * Get all atoms for a specific project.
 */
export declare function getProjectContext(db: Database.Database, project: string): string | null;
/**
 * List all atoms with optional filtering.
 */
export declare function listAtoms(db: Database.Database, options?: {
    type?: string;
    scope?: string;
    project?: string;
}): Atom[];
/**
 * Get all links for an atom (both directions).
 */
export declare function getAtomLinks(db: Database.Database, atomId: string): AtomLink[];
/**
 * Get all diagnostics, optionally filtered by type.
 */
export declare function getDiagnostics(db: Database.Database, type?: string): Diagnostic[];
/**
 * Get all sessions, optionally filtered.
 */
export declare function listSessions(db: Database.Database, options?: {
    project?: string;
    status?: string;
}): Session[];
export type SessionWithVccPath = Session & {
    vcc_shrunk_path: string | null;
};
/**
 * Look up a single session by id. Returns undefined on a miss — an unknown
 * session_id is an expected, common case the caller branches on, not an error.
 */
export declare function getSessionById(db: Database.Database, sessionId: string): SessionWithVccPath | undefined;
/**
 * Record one session-content-search event. A plain, unguarded INSERT — no
 * try/catch here. The fail-open guard for search logging lives at the call
 * site in searchSession, so a constraint violation (e.g. a bad `source`)
 * propagates as a real throw from this thin wrapper.
 */
export declare function logSessionSearch(db: Database.Database, params: {
    sessionId: string;
    query: string;
    source: 'compacted' | 'full' | 'none';
    matchCount: number;
}): void;
export type SessionSearchSource = 'compacted' | 'full' | 'none';
export interface SessionSearchResult {
    status: 'ok' | 'no-matches' | 'session-not-found' | 'no-content';
    sessionId: string;
    query: string;
    source: SessionSearchSource;
    sourcesChecked: string[];
    matches: GrepMatch[];
    totalMatches: number;
    truncated: boolean;
    detail?: string;
}
/**
 * Compacted-first session content search with fallback to the full transcript.
 * Never throws — an outer try/catch produces a safe 'no-content' fallback on
 * any unexpected internal error. Logs exactly once, at the end, from a single
 * fail-open call site covering every terminal path (see architecture.md).
 */
export declare function searchSession(db: Database.Database, sessionId: string, query: string, opts?: GrepOptions): SessionSearchResult;
/**
 * Get database statistics for the dashboard.
 */
export declare function getStats(db: Database.Database): {
    totalAtoms: number;
    embeddedAtoms: number;
    atomsByType: Record<string, number>;
    atomsByScope: Record<string, number>;
    atomsByProject: Record<string, number>;
    totalMemories: number;
    embeddedMemories: number;
    memoriesByReview: Record<string, number>;
    totalLinks: number;
    totalSessions: number;
    totalDiagnostics: number;
    diagnosticsByType: Record<string, number>;
    totalSessionSearches: number;
    sessionSearchesBySource: Record<'compacted' | 'full' | 'none', number>;
};
//# sourceMappingURL=search.d.ts.map