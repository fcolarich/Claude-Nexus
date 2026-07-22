---
# INTENTS: task-002 — Author contradiction-detection DDR via add-ddr skill (HARD PRE-MERGE GATE)

## Task
{
  "id": "task-002",
  "title": "Author contradiction-detection DDR via add-ddr skill (HARD PRE-MERGE GATE)",
  "files": ["_documents/decisions/ddr-NNN-contradiction-detection.md", "_documents/design.md"],
  "depends_on": [],
  "risk": "low"
}

## Outcome
Ran the add-ddr skill directly (orchestrator-level, since smart-implementer has no Skill
tool access). Dedup-checked against ddr-001..004 — no overlap. Wrote DDR-005 at
_documents/decisions/ddr-005-contradiction-detection-design-heuristic-pre-filte.md via
add_ddr.py, then rebuilt the doc index (rebuild_index.py) — architecture.md, design.md,
notes.md, references.md regenerated; design.md now lists DDR-005.

DDR-005 records:
- The full detectContradictions pipeline (related-band shortlist -> divergence pre-filter
  -> bounded Haiku confirmation -> bidirectional contradicts links + stale diagnostic on
  conflict=true -> silent skip on conflict=false/parse-failure/throw -> idempotent self-heal
  re-derivation of contradiction diagnostics every run).
- The resolved bidirectional-write decision: TWO directional memory_links rows per
  confirmed pair (a->b and b->a), per architecture.md over design.md's "one row" wording —
  architecture.md wins as the later, more detailed doc.
- The diagnostics/decay.ts collision resolution: the contradicts link is durable, the
  stale diagnostic is a re-derivable surfacing artifact, self-healed every consolidate run
  without touching decay.ts.

A minor escaping artifact from the PowerShell payload (doubled apostrophes) was found and
fixed directly in the DDR file post-write, then the index was rebuilt again to pick up the
corrected text.

This DDR is a hard pre-merge gate per architecture.md KQ4 — tasks 005-011 and 013 (anything
touching detectContradictions) may now proceed since DDR-005 exists.

## Meta
- timestamp: 2026-07-22T00:05:00Z
- model: none (skill-driven documentation task, no implementer/reviewer agents spawned)
---
