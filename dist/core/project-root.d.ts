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
export declare function cwdToProjectSlug(cwd: string): string | null;
/**
 * Resolve the canonical project root directory for a cwd via its git repository.
 * `git rev-parse --git-common-dir` always points at the *main* checkout's .git
 * directory (even from inside a worktree), so its parent is the one true project
 * root regardless of which subdirectory or worktree the caller is in. Falls back
 * to the raw cwd unchanged when git is unavailable, times out, or cwd isn't a repo
 * — callers must never block on this.
 */
export declare function resolveGitProjectRoot(cwd: string): string;
/** Compose git-root resolution with slugging — the one function every live-cwd call site should use. */
export declare function resolveProjectSlug(cwd: string): string | null;
//# sourceMappingURL=project-root.d.ts.map