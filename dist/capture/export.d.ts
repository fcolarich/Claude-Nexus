/**
 * Markdown export — materializes approved memories from the DB to disk.
 *
 * The DB is the system of record; this regenerates a human-readable mirror
 * under capture.export_dir (a Nexus-owned sandbox, default
 * ~/.claude/memories/exports). Deliberately NOT ~/.claude/projects/<project>/memory:
 * that directory is auto-loaded in full by Claude Code's own native
 * auto-memory feature at every session start, which would duplicate and
 * conflict with prompt-runner's per-prompt relevance-floored recall.
 */
import Database from 'better-sqlite3';
export interface ExportResult {
    buckets: number;
    files: number;
    dir: string;
}
/**
 * Export every approved, non-superseded memory to capture.export_dir.
 * One subdir per project (global/shared memories go to `_global`), each with
 * a MEMORY.md index and one file per memory. Stale .md files are pruned.
 */
export declare function exportAll(db: Database.Database, exportDirOverride?: string): ExportResult;
//# sourceMappingURL=export.d.ts.map