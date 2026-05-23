import type { AtomType, SourceType } from '../core/types.js';
import Database from 'better-sqlite3';
export interface CoworkSession {
    auditPath: string;
    metaPath: string | null;
    workspaceId: string;
    participantId: string;
    sessionDirName: string;
}
export interface SourceFile {
    path: string;
    sourceType: SourceType;
    atomTypeOverride?: AtomType;
}
/**
 * Discover all indexable source files in the Claude directory.
 */
export declare function discoverSources(): SourceFile[];
/**
 * Discover all session JSONL files across projects.
 */
export declare function discoverSessions(): {
    path: string;
    project: string;
}[];
/**
 * Discover Cowork (desktop app) audit.jsonl sessions from the Windows Claude package directory.
 */
export declare function discoverCoworkSessions(): CoworkSession[];
/**
 * Discover all project .md files from sessions that have a cwd set.
 * Returns SourceFile[] with sourceType='project_doc' and derived atomTypeOverride.
 */
export declare function discoverProjectDocs(db: Database.Database): SourceFile[];
/**
 * Get directories to watch for file changes.
 */
export declare function getWatchPaths(): string[];
//# sourceMappingURL=scanner.d.ts.map