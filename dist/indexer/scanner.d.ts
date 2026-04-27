import type { SourceType } from '../core/types.js';
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
 * Get directories to watch for file changes.
 */
export declare function getWatchPaths(): string[];
//# sourceMappingURL=scanner.d.ts.map