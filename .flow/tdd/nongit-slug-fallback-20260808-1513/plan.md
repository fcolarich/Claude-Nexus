# Plan: nongit-slug-fallback

Branch: `feature/nongit-slug-fallback`

## Tasks

| ID | Title | Files | Depends On | Tokens |
|----|-------|-------|------------|--------|
| task-001 | Add origin.test.ts coverage for non-project-cwd exclusion | src/capture/origin.test.ts | — | 3200 |
| task-002 | Implement non-project-cwd exclusion in classifyOrigin() | src/capture/origin.ts | task-001 | 4200 |
| task-003 | Thread session cwd into reflector.ts's classifyOrigin() call | src/capture/reflector.ts | task-002 | 1600 |
| task-004 | Thread session cwd into purge-origin.mjs's classifyOrigin() call | scripts/purge-origin.mjs | task-002 | 1800 |
| task-005 | Document non-git fallback and known custom-parent-folder gap in file-map.md | _documents/file-map.md | — | 1100 |

Total estimated tokens: 11,900

## Notes

- Build order: task-001 (red) -> task-002 (green) -> {task-003, task-004 in parallel}. task-005 has no code dependency, can land anytime.
- Resolved open question: the `C:\Fran`-style custom-parent-folder gap is documented as a known gap only in file-map.md (task-005), cross-referencing design.md's Non-goals/Key Questions. No `add-feature` entry filed (lower-ceremony option).
- Full detail in impl-spec.md, including the AC-to-task coverage matrix.
