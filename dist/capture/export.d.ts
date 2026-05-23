/**
 * Markdown export — materializes approved memories from the DB to disk.
 *
 * The DB is the system of record; this regenerates a human-readable mirror.
 * Phase 2 writes to capture.export_dir (a Nexus-owned sandbox). The deliberate
 * cutover repoints export_dir at ~/.claude/projects/<project>/memory once
 * capture is verified — only then does the harness load DB-generated memory.
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