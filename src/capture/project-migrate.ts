/**
 * Project-alias migration — one-time (and safely re-runnable) merge of project
 * buckets that fragmented before git-root-based resolution existed: pre-2026-06-28
 * slug bugs (space/dot/worktree suffixes never collapsed) and subdirectories of
 * the same git repo that were treated as separate projects.
 *
 * Builds aliases from each project's most-recently-active session cwd, resolved
 * through the same git-aware logic the live capture path now uses (resolveProjectSlug).
 * If that resolves to a slug different from the one already on record, every row
 * under the old slug is folded onto the canonical one. Stale on-disk export
 * directories are cleaned up as a side effect of the exportAll() call at the end
 * (see its bucket-pruning fix) — no separate deletion code needed here.
 */

import Database from 'better-sqlite3';
import { resolveProjectSlug } from '../core/project-root.js';
import { consolidateMemories, type ConsolidateResult } from '../core/consolidate.js';
import { exportAll, type ExportResult } from './export.js';

export interface ProjectAlias {
  alias: string;
  canonical: string;
}

export interface MigrateReport {
  aliases: ProjectAlias[];
  memoriesUpdated: number;
  atomsUpdated: number;
  sessionsUpdated: number;
  merged: number;
  dryRun: boolean;
}

export interface MigrateProjectsOptions {
  dryRun: boolean;
  projectsDir?: string;
}

export interface MigrateProjectsDeps {
  consolidate?: (db: Database.Database) => Promise<ConsolidateResult>;
  exportAll?: (db: Database.Database, exportDirOverride?: string) => ExportResult;
}

/**
 * Find every project whose recorded slug doesn't match git-root resolution of a
 * cwd it actually ran from. Any session's cwd works — historical rows almost
 * always share the exact same cwd for a given project bucket (that's the whole
 * point), and last_active is NULL for most bulk-indexed rows so it can't be used
 * to prefer "the most recent" one.
 */
export function buildProjectAliases(db: Database.Database): ProjectAlias[] {
  const rows = db.prepare(`
    SELECT project, cwd FROM sessions
    WHERE cwd IS NOT NULL AND cwd != '' AND project IS NOT NULL
    GROUP BY project
  `).all() as { project: string; cwd: string }[];

  const aliases: ProjectAlias[] = [];
  for (const row of rows) {
    const canonical = resolveProjectSlug(row.cwd);
    if (canonical && canonical !== row.project) {
      aliases.push({ alias: row.project, canonical });
    }
  }
  return aliases;
}

/** Merge every alias's rows onto its canonical slug across memories/atoms/sessions. Records each alias in project_aliases. No-op in dry-run mode. */
export function applyProjectAliases(db: Database.Database, aliases: ProjectAlias[], dryRun: boolean): MigrateReport {
  const report: MigrateReport = {
    aliases, memoriesUpdated: 0, atomsUpdated: 0, sessionsUpdated: 0, merged: 0, dryRun,
  };
  if (dryRun || aliases.length === 0) return report;

  const recordAlias = db.prepare(
    `INSERT OR REPLACE INTO project_aliases (alias_slug, canonical_slug) VALUES (?, ?)`
  );
  const updateMemories = db.prepare(`UPDATE memories SET project = ? WHERE project = ?`);
  const updateAtoms = db.prepare(`UPDATE atoms SET project = ? WHERE project = ?`);
  const updateSessions = db.prepare(`UPDATE sessions SET project = ? WHERE project = ?`);

  db.transaction(() => {
    for (const { alias, canonical } of aliases) {
      recordAlias.run(alias, canonical);
      report.memoriesUpdated += updateMemories.run(canonical, alias).changes;
      report.atomsUpdated += updateAtoms.run(canonical, alias).changes;
      report.sessionsUpdated += updateSessions.run(canonical, alias).changes;
    }
  })();

  return report;
}

/** Full orchestration: build aliases, merge, dedup any collisions the merge created, re-export. */
export async function migrateProjects(
  db: Database.Database,
  opts: MigrateProjectsOptions,
  deps?: MigrateProjectsDeps
): Promise<MigrateReport> {
  const aliases = buildProjectAliases(db);
  const report = applyProjectAliases(db, aliases, opts.dryRun);
  if (opts.dryRun) return report;

  if (report.memoriesUpdated > 0) {
    const consolidate = deps?.consolidate ?? consolidateMemories;
    const { merged } = await consolidate(db);
    report.merged = merged;

    const doExport = deps?.exportAll ?? exportAll;
    doExport(db);
  }

  return report;
}
