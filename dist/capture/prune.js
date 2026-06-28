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
export function selectNarrationMemories(db) {
    const rows = db.prepare(`SELECT id, title, memory_type FROM memories WHERE memory_type = 'handoff'`).all();
    return rows.map(r => ({ id: r.id, title: r.title, memory_type: r.memory_type, reason: 'handoff' }));
}
//# sourceMappingURL=prune.js.map