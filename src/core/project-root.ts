import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';
import type Database from 'better-sqlite3';

/**
 * Derive the project slug from a cwd path, matching the current Claude Code
 * ~/.claude/projects/ convention: replace :, path separators, spaces, dots, and
 * underscores with '-'. ("LLM_Workflow_Optimization" → "C--Fran-LLM-Workflow-Optimization",
 * "Voodoo Magic" → "C--Fran-Voodoo-Magic", "com.x.y" → "com-x-y").
 *
 * Also collapses a literal `.worktrees`/`.claude-worktrees` path segment as a
 * defensive fallback for when git itself isn't available — resolveProjectSlug
 * below handles the general case via the actual git repo root.
 */
export function cwdToProjectSlug(cwd: string): string | null {
	const slug = cwd
		.replace(/[:\\/ ._]/g, '-')
		.replace(/-+(claude-)?worktrees?-.*$/, '')
		.replace(/^-+|-+$/g, '');
	return slug.length >= 3 ? slug : null;
}

/**
 * Resolve the canonical project root directory for a cwd via its git repository.
 * `git rev-parse --git-common-dir` always points at the *main* checkout's .git
 * directory (even from inside a worktree), so its parent is the one true project
 * root regardless of which subdirectory or worktree the caller is in. Falls back
 * to the raw cwd unchanged when git is unavailable, times out, or cwd isn't a repo
 * — callers must never block on this.
 */
export function resolveGitProjectRoot(cwd: string): string {
	try {
		const commonDir = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], {
			encoding: 'utf-8',
			timeout: 2000,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		if (!commonDir) return cwd;
		return dirname(resolve(cwd, commonDir));
	} catch {
		return cwd;
	}
}

/** Compose git-root resolution with slugging — the one function every live-cwd call site should use. */
export function resolveProjectSlug(cwd: string): string | null {
	return cwdToProjectSlug(resolveGitProjectRoot(cwd));
}

/**
 * Resolve a project slug from a working-directory path, with a fallback for
 * projects whose stored rows predate the git-root slugging convention:
 * 1. Git-root-resolved slug via resolveProjectSlug (collapses worktrees and
 *    subdirectories onto the repo root, e.g. "C--Fran-Monster-Hotel").
 * 2. Short-name fallback (last path segment lowercased, e.g. "monster-hotel"). Handles projects
 *    whose rows were created with a short name rather than the full path slug.
 * Each candidate is checked against atoms AND sessions/memories so every caller
 * (nexus_backfill, nexus_search, distill, ...) resolves against real data.
 */
export function resolveProjectFromCwd(db: Database.Database, cwd: string): string {
	const known = (slug: string) =>
		!!db.prepare(`SELECT 1 FROM atoms WHERE project = ? LIMIT 1`).get(slug) ||
		!!db.prepare(`SELECT 1 FROM sessions WHERE project = ? LIMIT 1`).get(slug) ||
		!!db.prepare(`SELECT 1 FROM memories WHERE project = ? LIMIT 1`).get(slug);

	const derived = resolveProjectSlug(cwd);
	if (derived && known(derived)) return derived;

	const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
	const shortName = parts[parts.length - 1]?.toLowerCase().replace(/_/g, '-');
	if (shortName && shortName !== derived?.toLowerCase() && known(shortName)) return shortName;

	return derived ?? shortName ?? cwd;
}
