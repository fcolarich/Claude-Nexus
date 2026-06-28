/**
 * One-time sweep: identify low-value auto-captured memories — handoffs,
 * completion/progress narration, and ADR/DDR-duplicate decisions — across
 * every project. The CLI (`nexus prune-narration`) hard-deletes them.
 */

import Database from 'better-sqlite3';
import { COMPLETION_RE, ADR_REF_RE } from './extract.js';

export interface PruneCandidate {
  id: string;
  title: string;
  memory_type: string;
  reason: 'handoff' | 'completion-narration' | 'adr-ddr-duplicate';
}

export function selectNarrationMemories(db: Database.Database): PruneCandidate[] {
  const rows = db.prepare(`SELECT id, title, body, memory_type FROM memories`).all() as
    { id: string; title: string; body: string; memory_type: string }[];
  const out: PruneCandidate[] = [];
  for (const r of rows) {
    const base = { id: r.id, title: r.title, memory_type: r.memory_type };
    if (r.memory_type === 'handoff') { out.push({ ...base, reason: 'handoff' }); continue; }
    if (COMPLETION_RE.test(r.title) || COMPLETION_RE.test(r.body)) { out.push({ ...base, reason: 'completion-narration' }); continue; }
    if (r.memory_type === 'decision' && ADR_REF_RE.test(r.body)) { out.push({ ...base, reason: 'adr-ddr-duplicate' }); continue; }
  }
  return out;
}
