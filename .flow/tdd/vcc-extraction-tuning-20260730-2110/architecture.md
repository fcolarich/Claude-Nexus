# Architecture: vcc Extraction Tuning (3-feature batch)

## Components

### Extractor (`src/capture/extract.ts`)
**Responsibility:** Build the extraction prompt, call the model, and parse/validate/cap the raw JSON response into typed `MemoryCandidate[]`.
**Interface:**
```ts
export type Extractor = (
  condensed: string,
  ctx: { project: string | null; decisions?: string[]; source?: 'vcc' | 'generic' }
) => Promise<MemoryCandidate[]>;

const MAX_CANDIDATES_GENERIC = 20;   // was flat MAX_CANDIDATES
const MAX_CANDIDATES_VCC = 40;

export function parseCandidates(raw: string, maxCandidates: number = MAX_CANDIDATES_GENERIC): MemoryCandidate[]; ...

export async function extractMemories(
  condensed: string,
  ctx: { project: string | null; decisions?: string[]; source?: 'vcc' | 'generic' }
): Promise<MemoryCandidate[]>; ...
```

### Reflector (`src/capture/reflector.ts`)
**Responsibility:** Own the reflection cursor and orchestrate compaction → extraction → dedup/supersede → insert for one session window; decide `source` and build `validIds` for that window.
**Interface:**
```ts
function isReferenceUpgrade(
  candidate: MemoryCandidate,
  matched: Memory,
  validIds: Set<string>
): boolean; // fails closed: no match in body, or id not in validIds -> false

export async function reflect(
  db: Database.Database, opts: ReflectOptions, deps: ReflectDeps = {}
): Promise<ReflectResult>; // signature unchanged
```

### Doc-Spine Reader (`src/capture/docspine.ts`) — unchanged this batch
**Responsibility:** Scan `_documents/decisions/` and return `"ADR-NNN: Title"` strings for known ADR/DDR records; degrade to `[]` on any filesystem issue.
**Interface:**
```ts
export function readDecisionIndex(cwd: string | undefined): string[]; // no change
```
Known quirk (not fixed here, see Decisions/Open Questions): id derivation at line 21 assumes short-form filenames (`adr-NNN-slug.md`). Timestamp-form filenames (`adr-YYYYMMDDHHMMSS-xx-slug.md`) yield `ADR-YYYYMMDDHHMMSS` instead of `ADR-NNN`.

---

## Data Flow

### `reflect()` processes a new transcript window
1. `reflect()` reads the window and attempts `vcc.compactWindowLines()` (reflector.ts:107).
2. `reflect()` derives `source: 'vcc' | 'generic'` from `compacted.ok && !!compacted.text` — same boolean already gating `extractionText` selection, no new state.
3. `reflect()` calls `readDecisionIndex(opts.cwd)` (unchanged call, reflector.ts:114) and derives `validIds = new Set<string>` from it, once per window — no new filesystem read.
4. `reflect()` calls `extract(extractionText, { project, decisions, source })` — `source` added as a third key alongside the existing two.
5. `extractMemories()` picks `maxCandidates = ctx.source === 'vcc' ? MAX_CANDIDATES_VCC : MAX_CANDIDATES_GENERIC` and passes it into `parseCandidates(raw, maxCandidates)`.
6. `parseCandidates()` caps `out.length` against the passed-in limit instead of a closed-over module constant.
7. Back in `reflect()`'s per-candidate loop, on a dedup hit, `isReferenceUpgrade(c, sim.memory, validIds)` replaces the old two-arg call (reflector.ts:129).
8. If `isReferenceUpgrade` returns `true`: existing supersede-insert transaction runs unchanged. If `false` (including empty `validIds` or unresolved id): falls through to the existing `touchMemory` / merge path — same code path as any non-reference-upgrade candidate today. No candidate is ever dropped by this change.

---

## Storage

No new tables/columns. Two in-flight data-shape changes to document:

### `ctx` param (extract.ts / reflector.ts boundary)
```ts
{
  project: string | null;
  decisions?: string[];   // unchanged — "ADR-NNN: Title" strings from readDecisionIndex()
  source?: 'vcc' | 'generic';  // NEW — omitted/undefined treated as 'generic' (falls to MAX_CANDIDATES_GENERIC)
}
```

### `validIds` (reflector.ts, built per-window, not persisted)
```ts
Set<string>  // e.g. {"ADR-075", "DDR-012"} — uppercased id prefix only, no title
```
Built from `decisions.map(d => d.split(':')[0].trim().toUpperCase())`. Empty array in → empty Set → `isReferenceUpgrade` always `false` for that window (fail-closed, matches Success Criteria: no doc-spine ⇒ no wrongful supersede).

---

## Decisions

### Phase-section-cue: no pre-existing addendum found in scope
**Decision:** Grepped `SYSTEM_PROMPT` (extract.ts:50-106) in full — no existing sentence mentions `### Phase:`, "phase section", or per-phase scanning anywhere in the current prompt. The "small addendum" design.md references (Key Question 2) is not present in any of the three in-scope files. Treat this as a fresh addition, not a fold-in/merge. Insert a new paragraph near the other extraction-scope rules (after the "Rules:" block around line 105, before the STRICT JSON output rule) reading approximately: *"If the transcript contains `### Phase:` headings (a Flow-structured session), treat each phase section as an independent extraction unit — scan every phase for durable facts rather than skimming the transcript as one flat block. Distinct phases (design/architect/execute/merge) commonly carry distinct ADR/DDR pointers, tool quirks, and decisions."*
**Alternatives:** Search wider (transcript.ts, vcc-bridge.ts, or git history) for the addendum. Rejected — out of scope per this task's file allowlist ("read only the files explicitly passed"); the planner/implementer can re-grep at implementation time if this finding is surprising, but architecture should not silently assume the design doc's premise is correct when the scoped read contradicts it.
**Rationale:** Writing a duplicate-of-nothing paragraph is safe; assuming an addendum exists and trying to "fold in" text that isn't there risks inventing phantom prior wording. Flagged as resolved Key Question, not left open.

### `MAX_CANDIDATES_VCC = 40`
**Decision:** Confirm design's proposed value: `MAX_CANDIDATES_GENERIC = 20` (unchanged), `MAX_CANDIDATES_VCC = 40` (2x).
**Alternatives:** Scale toward ADR-075's 52.7x compaction ratio (e.g. cap in the hundreds); leave as a config-driven tunable in `extraction_models.yaml`.
**Rationale:** 52.7x is a *text-density* compaction ratio, not a 1:1 proxy for extractable-fact count — scaling the candidate cap by the same factor conflates "fewer tokens per fact" with "proportionally more facts per window," which doesn't hold (compaction removes redundant narration, not distinct facts). 2x is a deliberately conservative multiplier: enough headroom to stop silent truncation on genuinely denser vcc-compacted windows, without inflating downstream review-queue load (every candidate can become a `pending` row needing human review) or per-window LLM-output token cost. Config-driven limits rejected as over-engineering for one numeric variant (per design's own non-goals). Value is trivially adjustable in one place if a future measurement shows 40 is still truncating.

### `parseCandidates()` gets a default param, not a required one
**Decision:** `parseCandidates(raw: string, maxCandidates: number = MAX_CANDIDATES_GENERIC)`.
**Alternatives:** Require the caller to always pass a limit explicitly.
**Rationale:** Keeps any direct/legacy callers or tests that call `parseCandidates(raw)` alone compiling and behaviorally identical (falls to today's cap). Only `extractMemories()` needs to resolve `ctx.source` → pass an explicit limit.

### `isReferenceUpgrade()` gets a required third param
**Decision:** `validIds: Set<string>` is required, not optional/defaulted.
**Alternatives:** Default to `new Set()` so old two-arg call sites keep compiling.
**Rationale:** This function has exactly one production call site (reflector.ts:129), fully controlled in this same change — no external caller to protect. A silent default would mask the exact bug this feature fixes (an accidental two-arg call would fail-closed to "never upgrade," burying a regression instead of surfacing a compile error). Making it required forces every call site — including test call sites — to state its `validIds` intent explicitly.

### `docspine.ts` timestamp-ID quirk: confirmed, not fixed
**Decision:** Leave `docspine.ts` untouched this batch, per design non-goals.
**Alternatives:** Fix the id-derivation (line 21) to detect and short-form timestamp-style filenames.
**Rationale:** Out of scope per design and per this task's file allowlist. Confirmed mechanically: for `adr-20260727195020-a0-slug.md`, `f.replace(/\.md$/i,'').split('-').slice(0,2).join('-').toUpperCase()` yields `ADR-20260727195020`, not `ADR-075`. This means item 3's `validIds.has(id)` check will never match a citation like `"ADR-075"` against a repo using timestamp-style filenames — the candidate falls through to touch-and-continue (fail-closed, same safe outcome as an unresolvable id, just for the wrong reason). Whether claude-nexus's own `_documents/decisions/` uses short-form or timestamp-form filenames was NOT verified — reading that directory is outside this task's declared file scope (extract.ts / reflector.ts / docspine.ts only). Left as an Open Question below rather than assumed.

---

## Open Questions
<!-- These must be resolved before /plan runs. Planner will fail if ambiguous. -->
- Does claude-nexus's own `_documents/decisions/` (the repo this pipeline runs against) use short-form (`adr-NNN-slug.md`) or timestamp-form (`adr-YYYYMMDDHHMMSS-xx-slug.md`) filenames? If timestamp-form, item 3's validation will fail-closed on every citation in practice (safe, but silently ineffective) — worth a follow-up FEAT for docspine.ts regardless of this batch's non-goal status.
- `reflector.test.ts` currently exercises `isReferenceUpgrade`-adjacent behavior (per design.md) but that file wasn't read (out of scope for architecture). Planner must open it to confirm: is `isReferenceUpgrade` called directly in tests (needs every call site updated with a `validIds` arg — signature-breaking), or only indirectly via `reflect()` fixtures (needs new fixture decisions/citations, purely additive)?
- Confirm `MAX_CANDIDATES_VCC = 40` is acceptable, or supply real measurement data (e.g. observed candidate counts on actual vcc-compacted windows) to size it differently before planning.
