# Per-skill memory scope (beyond project/shared/global)

**Source**: _documents/features/feature-20260805151847-56-per-skill-memory-scope-beyond-projectsharedglobal.md

## Summary

FEAT-20260805151847-56 proposes introducing a fourth scope partition for Nexus memories, keyed to the invoking skill or agent, beyond the current project/shared/global hierarchy. The feature is marked as planned but requires research because no implementation approach has been decided. The core motivation is investigating whether skill-level scope isolation would reduce cross-skill memory noise. The proposal references related work in the pi-coding-agent-forge project, which documents a per-skill runtime memory file concept. The feature must be designed in relation to existing scope isolation mechanisms (FEAT-006) to understand interaction patterns and ensure compatibility.

## Key facts

- Status is "planned" as of 2026-08-05 (FEAT-20260805151847-56)
- Proposes a fourth scope partition keyed to the invoking skill/agent
- Current scope hierarchy consists of project/shared/global levels
- Implementation approach is not yet decided; needs research
- Motivation is reducing cross-skill memory noise
- Must interact with existing scope isolation (FEAT-006)
- Related proposal exists in pi-coding-agent-forge project: "per-skill runtime memory file"

## Open questions

- What implementation approach should be chosen for the skill-keyed scope partition?
- How would the new skill-level scope interact with existing scope isolation mechanisms in FEAT-006?
- What specific cross-skill memory noise problems does this feature aim to address?
- What are the performance, complexity, or storage tradeoffs of introducing a fourth scope level?
