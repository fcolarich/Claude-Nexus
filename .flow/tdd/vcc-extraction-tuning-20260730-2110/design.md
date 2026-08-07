# Design — vcc extraction tuning (3 features)

Session: vcc-extraction-tuning-20260730-2110
Repo: C:\Fran\claude-nexus (main branch, clean tree at design time)
Files in scope: `src/capture/extract.ts`, `src/capture/reflector.ts`, `src/capture/docspine.ts`

Bundles three related FEAT items from the memory-extraction pipeline:
- FEAT-20260730150641-ad — phase-section-cue prompt tuning
- FEAT-20260730150650-7f — raise MAX_CANDIDATES for vcc-sourced extraction
- FEAT-20260730150659-74 — validate cited ADR/DDR id before Fix-1 supersede

## Problem

Three known gaps in the Reflector's memory-extraction path, all discovered/validated in prior sessions but not yet shipped:

1. **Prompt tuning not in production.** An experiment validated that treating each `### Phase:` section of a Flow-structured transcript as an independent extraction unit recovers more durable facts (ADR/DDR pointers, concurrency bugs, tool quirks) than the current flat-transcript prompting. Only a small addendum shipped — the full cue is missing from `SYSTEM_PROMPT` (extract.ts:50-106).
2. **MAX_CANDIDATES may truncate vcc-compacted windows.** `MAX_CANDIDATES = 20` (extract.ts:30) is a flat cap applied in `parseCandidates()` (extract.ts:141) regardless of how the extraction text was produced. `reflect()` (reflector.ts:104-112) always attempts `vcc.compactWindowLines()` first and only falls back to raw `window.text` if compaction fails. vcc-compacted text is denser (ADR-075: 52.7x compaction ratio on real transcripts) and can plausibly contain more than 20 distinct extractable facts per window — the flat cap silently drops the tail with no signal that truncation happened.
3. **Fix 1 supersede trusts an unvalidated citation.** `isReferenceUpgrade()` (reflector.ts:56-61) gates the supersede-insert transaction (reflector.ts:129-166) on `ADR_REF_RE.test(candidate.body)` — a bare shape match (`/\b(ADR|DDR)-\d+/i`). The LLM extractor can hallucinate a plausible-looking but nonexistent ADR/DDR id. A hallucinated citation currently supersedes a real `decision` memory row, corrupting the row's `superseded_by` state with no way to detect it happened.

## Goals

- `SYSTEM_PROMPT` instructs the extractor to treat each `### Phase:` section as an independent extraction unit (folding in the validated experiment's cue, replacing/extending the existing small addendum).
- Extraction text sourced from a successful vcc compaction gets a materially higher candidate cap than the generic/fallback path, without raising the generic path's cap.
- `isReferenceUpgrade()` only allows the supersede path when the cited ADR/DDR id corresponds to a real record already surfaced by `readDecisionIndex()`; on an unresolvable id it falls through to the ordinary touch-and-continue dedup path (same as today's non-reference-upgrade case) — never silently drops the candidate.

## Non-goals

- No refactor of `extract()`'s ctx parameter into a larger structured object (evaluated in brainstorming, rejected as premature — see Approach below).
- No change to `extraction_models.yaml` / provider config.
- No change to the Observer gate (skip logic) or to `readTranscriptWindow()`.
- No change to how `readDecisionIndex()` scans `_documents/decisions/` (reused as-is).
- Not fixing the ID-extraction quirk in `docspine.ts:21` for collision-safe timestamp-based ADR/DDR filenames (`adr-20260727195020-a0-...` → currently yields `ADR-20260727195020` instead of a short `ADR-NNN` form) — out of scope for this batch; noted as a Key Question below since it affects whether validation matches real-world filenames in repos that adopted the new ID scheme.

## Constraints

None declared. Existing test conventions (reflector.test.ts, consolidate.test.ts style: real better-sqlite3 db fixtures, injected fake `deps`) apply to any new tests.

## Proposed Approach

**Chosen: minimal targeted patch** (rejected alternatives: a structured `ExtractionContext` object — touches every call site/fixture for a change that doesn't need it yet; config-driven limits via YAML — overkill for one new numeric variant). Three independent, small edits:

**1. Phase-section-cue (FEAT-...-ad)**
Add a paragraph to `SYSTEM_PROMPT` (extract.ts) instructing: treat each `### Phase:` heading in the transcript as an independent extraction unit — scan every phase section for durable facts rather than skimming the transcript as one flat block, since phase-scoped context (a Flow's design/architect/execute/merge sections) commonly carries distinct ADR/DDR pointers, tool quirks, and decisions per phase. Locate and fold in whatever the existing "small addendum" already says (grep SYSTEM_PROMPT for any phase-related sentence first) rather than duplicating it.

**2. Source-aware MAX_CANDIDATES (FEAT-...-7f)**
- `reflect()` already knows whether extraction text came from vcc (`compacted.ok && compacted.text`, reflector.ts:108) or the raw fallback. Thread that as `source: 'vcc' | 'generic'` into the existing `ctx` param of `extract()`/`extractMemories()` (alongside `project` and `decisions` — no new object).
- In extract.ts, replace the flat `MAX_CANDIDATES = 20` with two constants (e.g. `MAX_CANDIDATES_GENERIC = 20`, `MAX_CANDIDATES_VCC = 40` — exact vcc number confirmed with user during architecture, informed by the 52.7x compaction ratio) and pick by `ctx.source` inside `extractMemories()`, passing the resolved limit into `parseCandidates()` as a parameter instead of a module constant it closes over.

**3. Validated supersede (FEAT-...-74)**
- `reflect()` already calls `readDecisionIndex(opts.cwd)` (reflector.ts:114) producing strings like `"ADR-075: title"`. Derive a `Set<string>` of just the ids (`"ADR-075"`, uppercased) from that same array — no new filesystem read.
- Pass the set into `isReferenceUpgrade(candidate, matched, validIds)`. Change the function to extract the matched id from `candidate.body` via `ADR_REF_RE` and require `validIds.has(id.toUpperCase())` in addition to the existing checks. Fails closed: if `validIds` is empty (no doc-spine, or `opts.cwd` undefined) or the id isn't found in it, `isReferenceUpgrade` returns `false` — the candidate falls through to the existing `touchMemory` dedup path (reflector.ts:169-170), exactly like a candidate that was never a reference-upgrade case. No candidate is dropped; it's just demoted from "supersede" to "reconfirm existing".

## Key Questions

1. Exact `MAX_CANDIDATES_VCC` value — proposed 40 (2x), but should be set/confirmed during `/architect` or left as a tunable the planner sizes based on any existing measurement data (e.g. `tests/test_measurement.py`-style evidence in the vcc_compact module, or the ADR-075 52.7x ratio).
2. Where exactly does the existing "small addendum" for phase-cues live in `SYSTEM_PROMPT` today — architect/planner should grep and diff against the validated experiment write-up before drafting final prompt text, to avoid duplicating or contradicting it.
3. `docspine.ts`'s ID-extraction (`f.replace(...).split('-').slice(0,2)...`) assumes short-form filenames (`adr-NNN-slug.md`). For repos using the newer collision-safe timestamp scheme (`adr-YYYYMMDDHHMMSS-xx-slug.md`, see the LLM_Workflow_Optimization repo), `readDecisionIndex()` would surface an id like `ADR-20260727195020` rather than `ADR-075`, so a citation like `ADR-075` would never validate even if the record exists under a different id form. Flagged as a known gap, explicitly out of scope — the architect should confirm whether claude-nexus itself is only ever pointed at short-form-ID repos (making this moot for now) or note it as a follow-up FEAT.
4. Test scope: reflector.test.ts already tests `isReferenceUpgrade`-adjacent supersede behavior — planner should confirm whether existing tests need updating (new required arg) vs. purely additive new cases for the hallucinated-id-rejection path. Per user constraint, no tests for the SYSTEM_PROMPT wording itself (not meaningfully testable) or for the MAX_CANDIDATES constant choice beyond a boundary test that the higher cap is actually applied when `source: 'vcc'`.

## Success Criteria

- `SYSTEM_PROMPT` contains an explicit phase-section-cue instruction; existing extract.ts tests (if any snapshot/assert on SYSTEM_PROMPT content) still pass or are updated.
- A test demonstrates: given `source: 'vcc'`, more than 20 (up to the new vcc cap) candidates survive `parseCandidates()`; given `source: 'generic'` (or omitted), the cap remains 20.
- A test demonstrates: `isReferenceUpgrade()` returns `false` (falls through to touch-and-continue, not supersede) when the candidate cites an ADR/DDR id absent from `validIds`, and still returns `true` for the existing valid-citation case (regression coverage for Fix 1's current passing behavior).
- No change in behavior for sessions with no doc-spine (`readDecisionIndex` returns `[]`) beyond what already happens today — with an empty `validIds` set, `isReferenceUpgrade` now returns `false` (previously it could return `true` on shape-match alone), meaning candidates that would have wrongly superseded now correctly fall through to touch-and-continue. This is the intended fix, not a regression.
