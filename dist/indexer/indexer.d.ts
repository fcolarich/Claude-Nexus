import Database from 'better-sqlite3';
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
 * Run a full index of all Claude data.
 */
export declare function runFullIndex(db: Database.Database): IndexStats;
/**
 * Re-index a single file (for file watcher).
 */
export declare function reindexFile(db: Database.Database, filePath: string, sourceType: SourceType): void;
export {};
//# sourceMappingURL=indexer.d.ts.map