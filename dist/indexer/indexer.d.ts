import Database from 'better-sqlite3';
import type { CoworkSession } from './scanner.js';
import type { SourceType } from '../core/types.js';
export interface IndexStats {
    atomsCreated: number;
    atomsUpdated: number;
    atomsUnchanged: number;
    linksCreated: number;
    diagnosticsCreated: number;
    sessionsIndexed: number;
}
interface PreparedStatements {
    getAtomBySourceAndIndex: Database.Statement;
    upsertAtom: Database.Statement;
    deleteAtomsBySource: Database.Statement;
    insertLink: Database.Statement;
    deleteLinksForSource: Database.Statement;
    insertDiagnostic: Database.Statement;
    clearDiagnosticsForSource: Database.Statement;
    upsertSession: Database.Statement;
}
/**
 * Index a single source file into the database.
 */
export declare function indexFile(db: Database.Database, stmts: PreparedStatements, filePath: string, sourceType: SourceType): {
    created: number;
    updated: number;
    unchanged: number;
    links: number;
    diagnostics: number;
};
/**
 * Index a session JSONL file — extracts metadata without parsing full conversation.
 */
export declare function indexSession(db: Database.Database, stmts: PreparedStatements, jsonlPath: string, projectSlug: string): void;
/**
 * Derive the project slug from a cwd path using the same convention Claude Code uses
 * for ~/.claude/projects/ directory names (replace :, path separators, and underscores with -).
 * Claude Code converts underscores to dashes: "LLM_Workflow_Optimization" → "C--Fran-LLM-Workflow-Optimization".
 */
export declare function cwdToProjectSlug(cwd: string): string;
/**
 * Index a Cowork (desktop app) audit.jsonl session.
 */
export declare function indexCoworkSession(db: Database.Database, session: CoworkSession): void;
/**
 * Embed all atoms that don't yet have a vector in atoms_vec.
 * Calls Ollama for each unembedded atom — async, non-blocking for the sync index.
 */
export declare function embedUnindexed(db: Database.Database): Promise<void>;
/**
 * Run a full index of all Claude data.
 */
export declare function runFullIndex(db: Database.Database): Promise<IndexStats>;
/**
 * Re-index a single file (for file watcher).
 */
export declare function reindexFile(db: Database.Database, filePath: string, sourceType: SourceType): void;
export {};
//# sourceMappingURL=indexer.d.ts.map