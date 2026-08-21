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
export interface ExportOptions {
    /**
     * IDs of memories inserted/merged by the caller's own operation. When set,
     * only these memories' files are (unconditionally) written and only their
     * bucket indexes are rebuilt — no directory listing, no disk read of
     * unrelated memories, no orphan-bucket pruning. Use for the per-session
     * capture hot path; omit for a full resync (CLI export, backfill, migrate).
     */
    touchedIds?: string[];
}
/**
 * Export every approved, non-superseded memory to capture.export_dir.
 * One subdir per project (global/shared memories go to `_global`), each with
 * a MEMORY.md index and one file per memory. Stale .md files are pruned.
 *
 * Full mode (no touchedIds) only fills in missing files — it never rewrites
 * an existing memory file, since nothing else keeps the mirror in sync with
 * in-place edits (consolidate/distill/dashboard edits don't call this), so a
 * content diff here would just be reads that never fire in practice.
 */
export declare function exportAll(db: Database.Database, exportDirOverride?: string, options?: ExportOptions): ExportResult;
//# sourceMappingURL=export.d.ts.map