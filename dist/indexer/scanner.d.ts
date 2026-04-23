import type { SourceType } from '../core/types.js';
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
 * Get directories to watch for file changes.
 */
export declare function getWatchPaths(): string[];
//# sourceMappingURL=scanner.d.ts.map