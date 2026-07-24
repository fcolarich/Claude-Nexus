---
# INTENTS: task-003 — MCP tool-surface audit note

## Task
{
  "id": "task-003",
  "title": "MCP tool-surface audit note",
  "description": "Read src/mcp/server.ts, enumerate every exposed MCP tool, and produce _documents/notes/note-NNN-mcp-tool-surface-audit.md via the add-note skill (assigns NNN, rebuilds _documents/notes.md through scripts/rebuild_index.py — do not hand-edit the index). Contents: current tool count vs the ADR-011 consolidation baseline, one line per tool, concrete grouping/consolidation candidates if any, and exactly one recommendation from {consolidate now | revisit later | no action}. Audit only — no MCP code change. Acceptance: SC-2 — note exists, index rebuilt, recommendation explicit.",
  "files": ["src/mcp/server.ts", "_documents/notes/note-NNN-mcp-tool-surface-audit.md", "_documents/notes.md"],
  "depends_on": [],
  "estimated_tokens": 6000,
  "complexity": "complex",
  "constraints": ["Q6"],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-003",
  "issues": [],
  "summary": "All SC-2 acceptance criteria satisfied. Note file exists at _documents/notes/note-001-mcp-tool-surface-audit-2026-07-21.md with correct NOTE-001 frontmatter. _documents/notes.md carries the auto-generated header and the NOTE-001 table row, consistent with rebuild_index.py output. Tool enumeration is complete and accurate: 20 server.tool() registrations in src/mcp/server.ts match the note's list one-for-one. Tool count vs ADR-011 baseline (20 vs 18, +2 post-ADR tools nexus_promotions and nexus_mark_promoted) correctly stated. Recommendation is 'Revisit later'. src/mcp/server.ts confirmed unmodified (git diff empty); no stray scratch files remain."
}

## Meta
- timestamp: 2026-07-21T23:52:00Z
- model: sonnet (implementer), sonnet (reviewer)
- note: implementer agent initially hand-wrote note.md/notes.md (lacked Bash tool); orchestrator discarded those and re-ran the real add_note.py + rebuild_index.py from the flow-initialize-project plugin scripts dir against C:\Fran\claude-nexus, which also upserted decisions.db.
---
