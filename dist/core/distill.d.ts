/**
 * Distill — LLM-driven cleanup of EXISTING memories.
 *
 * Where consolidation merges near-identical duplicates structurally, distill
 * goes further: it clusters *related* memories (medium similarity) and rewrites
 * each cluster into one tighter, non-redundant memory, then sanitizes verbose
 * singletons. Use it to clean up legacy / hand-written memories.
 *
 * The rewrite is mechanical (compress these given texts) rather than judgment —
 * a local model is a reasonable choice here. Uses the configured extraction
 * model via callModel().
 */
import Database from 'better-sqlite3';
import type { MemoryDuplicateVerdict } from './memory-dedup-confirm.js';
import type { Memory, MemoryType } from './types.js';
/**
 * Optional claim-level contradiction guard for cluster membership. Distill's
 * clustering is embedding-similarity-only (BAND_LOW=0.70, "related" not
 * "duplicate") — nothing stops it from merging two memories that are
 * topically close but state conflicting facts. Undefined by default —
 * existing callers/tests get exactly today's behavior; production wiring
 * passes confirmMemoryDuplicate bound to the SAME callFn distillation itself
 * uses, so decomposition runs on whatever model is configured for the sweep
 * (Haiku by default, or --merge-model's local model), never a hardcoded one.
 * Only 'contradicts' excludes a candidate — 'insufficient' still lets
 * embedding-based clustering proceed, since distill's own band is already
 * looser than a duplicate-confirmation bar.
 */
export type ContradictionGuardFn = (db: Database.Database, memoryA: {
    id: string;
    body: string;
    memory_type: MemoryType;
    confidence: number;
}, memoryB: {
    id: string;
    body: string;
    memory_type: MemoryType;
    confidence: number;
}) => Promise<MemoryDuplicateVerdict>;
export interface DistillOptions {
    project?: string;
    cwd?: string;
    limit?: number;
    dryRun?: boolean;
    since?: string;
}
export interface DistillResult {
    embedded: number;
    clusters: number;
    merged: number;
    created: number;
    rejected: number;
    sanitized: number;
    backendFailed: boolean;
    processed: number;
    eligibleRemaining: number;
    scope: string;
    dryRun: boolean;
}
/**
 * Exported so scripts/check-merge-model.mjs gates a candidate merge model against
 * the exact prompt distill uses, rather than a copy that can drift.
 *
 * The sentence budget scales with cluster size. The previous flat "1-4 sentences"
 * contradicted "drop nothing that matters" — a cluster of information-dense
 * memories cannot fit in 4 sentences, so models obeyed the cap and silently
 * discarded identifiers. An audit of 678 real merges (2026-07-26) measured ~30%
 * of file names, script names, config keys and shader keywords lost, on both
 * Haiku and a local model. Since distill supersedes the originals, that is
 * permanent loss, so the budget now yields to the facts rather than the reverse.
 */
export declare const mergePrompt: (clusterSize: number) => string;
export declare const SANITIZE_PROMPT = "Tighten this memory. Remove redundancy and filler; keep every distinct fact and the reasoning. Do not add anything.\n\nReproduce every identifier VERBATIM \u2014 file names and paths, function/script/class names, config keys, CLI flags, numbers, versions, URLs. Compress prose, never identifiers.\n\nOutput STRICT JSON ONLY: {\"title\": \"...\", \"body\": \"...\"}  No prose or fences.";
export type ResolvedScope = {
    kind: 'project';
    slug: string;
} | {
    kind: 'global';
} | {
    kind: 'all';
};
/**
 * Maps DistillOptions -> ResolvedScope. `project` wins over `cwd`; literal
 * `project: "global"` targets the global bucket. `cwd` derives a slug via
 * resolveProjectFromCwd — the same fallback-enhanced resolver nexus_backfill
 * and nexus_search use, so a project stored only under a short-name slug
 * still resolves instead of silently degrading to "all" (a clean-zero run).
 */
export declare function resolveScope(db: Database.Database, opts: DistillOptions | undefined): ResolvedScope;
/**
 * The sweep cursor predicate. A memory is a candidate only while it has never
 * been examined (`distilled_at IS NULL`), or — when the caller passes `since` —
 * was last examined before that cutoff. Without this, every invocation re-pulls
 * the identical top-`limit` window and a large scope can never be swept.
 */
export declare function cursorClause(since: string | undefined): string;
/** Pure SQL builder over the scope + cursor filter. Appends LIMIT :limit — countEligible never does. */
export declare function buildEligibleQuery(scope: ResolvedScope, limit: number, since?: string): {
    sql: string;
    params: Record<string, unknown>;
};
/**
 * Count of rows under scope that the cursor still considers un-examined — same
 * filter as buildEligibleQuery, no LIMIT. This is genuine remaining work, so a
 * caller looping until it hits 0 terminates.
 */
export declare function countEligible(db: Database.Database, scope: ResolvedScope, since?: string): number;
/**
 * Reject text showing signs of a mangled escape sequence.
 *
 * Some ambiguity is irreducible: in `C:\temp`, `\t` IS a legal JSON tab escape,
 * so a model that fails to double its backslashes yields `C:<TAB>emp` and no
 * parser can tell that from an intended tab. What we CAN say is that a merge body
 * is prose — control characters and bidi marks never belong in one — so their
 * presence means an escape was misread. Rejecting costs a cluster the cursor will
 * re-offer; accepting writes corruption over originals that are then superseded.
 */
export declare function hasEscapeDamage(text: string): boolean;
/**
 * Read a memory's already-stored embedding straight from memories_vec by
 * SQLite rowid — no schema change, no Ollama call. Returns null on any miss
 * (no row yet, or memories_vec/sqlite-vec unavailable) so callers fall back
 * to embedFn(m.body).
 */
export declare function loadStoredVector(db: Database.Database, memoryId: number): Float32Array | null;
/**
 * Cosine of a freshly written merge against every source it folded in, returning
 * the worst offender when any falls below MERGE_COVERAGE_FLOOR, else null.
 *
 * Vectors are stored normalized (embedMemory -> normalize), so cosine is a dot
 * product — no embedding calls, no model. Returns null when vectors are
 * unreadable (sqlite-vec absent): the gate fails OPEN, preserving today's
 * behaviour rather than blocking all merges on an unrelated capability.
 */
export declare function coverageShortfall(db: Database.Database, mergeId: string, sources: Memory[], floor?: number): {
    sourceId: string;
    similarity: number;
} | null;
export declare function distillMemories(db: Database.Database, opts?: DistillOptions, embedFn?: (text: string) => Promise<Float32Array | null>, callFn?: (system: string, user: string) => Promise<string>, contradictionGuardFn?: ContradictionGuardFn): Promise<DistillResult>;
//# sourceMappingURL=distill.d.ts.map