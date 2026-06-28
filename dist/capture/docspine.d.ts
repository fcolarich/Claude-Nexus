/**
 * Doc-spine reader — surfaces a project's existing ADR/DDR decisions so the
 * extractor can prefer thin pointers over restating canonical decisions.
 * Any filesystem error degrades to [] — a missing spine is the normal case.
 */
/** e.g. ["ADR-001: UPM package-per-tool baseline", "DDR-001: Naming convention"]. */
export declare function readDecisionIndex(cwd: string | undefined): string[];
//# sourceMappingURL=docspine.d.ts.map