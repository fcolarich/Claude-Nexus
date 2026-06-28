/**
 * One-time sweep: identify `handoff` memories — end-of-session state that we no
 * longer capture as a memory type (Task 1 dropped `handoff` from extraction).
 *
 * Scoped to handoff ONLY. An earlier design also swept completion-narration and
 * ADR/DDR-citing decisions via regex over the full corpus, but that matched
 * hundreds of legitimate conventions and decisions (the broad domain terms
 * "knowledge extraction", "doc spine", and bare ADR citations appear inside real
 * knowledge). Deletion must be precise, so we only remove the abandoned type.
 */
import Database from 'better-sqlite3';
export interface PruneCandidate {
    id: string;
    title: string;
    memory_type: string;
    reason: 'handoff';
}
export declare function selectNarrationMemories(db: Database.Database): PruneCandidate[];
//# sourceMappingURL=prune.d.ts.map