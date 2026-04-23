import Database from 'better-sqlite3';
import type { Atom, AtomLink, SearchResult, Diagnostic, Session } from './types.js';
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
 * "Smart fetch" — search for multiple topics and merge results into one markdown block.
 * This is the key MCP optimization: one tool call, all relevant context.
 */
export declare function fetchContext(db: Database.Database, topics: string[], options?: {
    project?: string;
    maxTokensEstimate?: number;
}): string | null;
/**
 * Get all atoms with global or shared scope.
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
/**
 * Get database statistics for the dashboard.
 */
export declare function getStats(db: Database.Database): {
    totalAtoms: number;
    atomsByType: Record<string, number>;
    atomsByScope: Record<string, number>;
    atomsByProject: Record<string, number>;
    totalLinks: number;
    totalSessions: number;
    totalDiagnostics: number;
    diagnosticsByType: Record<string, number>;
};
//# sourceMappingURL=search.d.ts.map