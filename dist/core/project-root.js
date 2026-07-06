import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';
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
export function cwdToProjectSlug(cwd) {
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
export function resolveGitProjectRoot(cwd) {
    try {
        const commonDir = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], {
            encoding: 'utf-8',
            timeout: 2000,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (!commonDir)
            return cwd;
        return dirname(resolve(cwd, commonDir));
    }
    catch {
        return cwd;
    }
}
/** Compose git-root resolution with slugging — the one function every live-cwd call site should use. */
export function resolveProjectSlug(cwd) {
    return cwdToProjectSlug(resolveGitProjectRoot(cwd));
}
//# sourceMappingURL=project-root.js.map