# Non-git-repo fallback for project-slug resolution reintroduces subdirectory fragmentation

**Source**: _documents/features/feature-003-non-git-repo-fallback-for-project-slug-resolution.md

## Summary

The project-slug resolution logic currently exhibits a regression when git is unavailable. The `resolveGitProjectRoot()` function in `src/core/project-root.ts` falls back to returning the raw, unmodified cwd when git is unavailable, times out, or the working directory is not inside a git repository. This fallback reintroduces the subdirectory-fragmentation problem that ADR-013 previously fixed for git-based scenarios: two subdirectories of the same non-git project resolve to two different project slugs instead of a single canonical slug. The feature identifies two possible paths forward: either build a non-git resolution heuristic (such as finding the nearest `package.json` or `.git` sibling) to unify slug resolution across all environments, or explicitly document this fallback as an accepted limitation of the system. The issue was identified as item 10 in claude-nexus-improvements-synthesis.md.

## Key facts

- `resolveGitProjectRoot()` in `src/core/project-root.ts` returns the cwd unchanged when git is unavailable, times out, or the cwd is not inside a git repository
- This fallback behavior reintroduces the subdirectory-fragmentation problem that ADR-013 previously fixed for the git case
- Two subdirectories of the same non-git project currently resolve to two different slugs instead of one canonical slug
- The feature proposes two possible solutions: build a non-git resolution heuristic (examples given: nearest `package.json` or `.git`-sibling) or explicitly document the fallback as an accepted limitation

## Open questions

- What non-git resolution heuristic should be implemented, if one is to be built?
- What other fallback strategies might be considered besides `package.json` and `.git`-sibling proximity?
- If the fallback is documented as an accepted limitation, what scenarios or use cases would explicitly not be supported?
- How should the decision between building a heuristic versus accepting the limitation be made—is there a priority or cost-benefit analysis?
