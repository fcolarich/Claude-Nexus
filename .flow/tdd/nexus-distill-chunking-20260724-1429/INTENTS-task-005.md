---
# INTENTS: task-005 — Reuse stored memories_vec vectors in the clustering loop (embedding-reuse fix)

## Task
{
  "id": "task-005",
  "title": "Reuse stored memories_vec vectors in the clustering loop (embedding-reuse fix)",
  "description": "In src/core/distill.ts add internal loadStoredVector(db, memoryId) -> Float32Array | null reading the existing memories_vec table (rowid = memories.id, column embedding). In the clustering loop, use the stored vector when present and only fall back to embedFn(m.body) on a miss, eliminating the ~12k redundant Ollama calls. Add a unit test in src/core/distill.test.ts with an embedFn spy: seed memories that all already have stored vectors and assert embedFn is called zero times in the loop (SC-2); assert a memory lacking a vector still falls back to embedFn. Update any existing test that previously asserted embedFn was called for already-embedded memories.",
  "files": ["src/core/distill.ts", "src/core/distill.test.ts", ".flow/tdd/nexus-distill-chunking-20260724-1429/impl-spec.md"],
  "depends_on": ["task-004"],
  "estimated_tokens": 11000,
  "complexity": "simple",
  "constraints": [],
  "risk": "medium"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-005",
  "issues": [],
  "summary": "loadStoredVector reads memories_vec by SQLite rowid; the clustering loop correctly bridges memories.id (TEXT content-hash) -> rowid via an extra SELECT before calling it, falling back to embedFn on any miss without throwing. Verified byte-symmetry between vecToBlob's write format and loadStoredVector's Float32Array reconstruction. Two new tests are meaningful and correctly isolate the reuse path from embedUnindexedMemories' own embedFn usage. No blockers."
}

## Meta
- timestamp: 2026-07-24T15:38:00Z
- model: sonnet (implementer), sonnet (reviewer)
- orchestrator verification: npx tsc --noEmit clean; npx vitest run src/core/distill.test.ts — 23/23 pass
---
