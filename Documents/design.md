# Claude Nexus — Design Decisions

Each entry records a design decision (UX, API shape, data model, naming, flow) not yet tied to a structural choice.
**Append new entries; never edit old ones — they document history.**
Maintained via the `add-ddr` skill. Overall design narrative lives at the top of this file or in linked topical sub-files; discrete decisions append as DDRs below.

Paired with [`architecture.md`](architecture.md) — a design change often implies an architecture decision, and vice versa. Update both together.

---

## DDR-001 — Initial design baseline: DB-owned memories with non-destructive decay and review gate

**Decision:** The `memories` table is DB-owned and written exclusively by the Reflector — not file-mirrored in the primary store (unlike `atoms`). Memory IDs are content-addressed (`sha256(memory_type + body)[:16]`) so identical extractions collapse to one row and near-duplicates are caught by semantic dedup. Decay is non-destructive: stored `confidence` is intrinsic; effective confidence = `confidence × decayFactor(decay_class, last_verified_at)`. Decayed memories fall out of recall but are never auto-deleted — `verify` revives them. Low-confidence extractions land in `review_status='pending'` and are excluded from recall until approved in the Review view. Superseded memories (from consolidate/distill) are kept as an audit trail (`superseded_by` FK), hidden from recall and export. Only explicitly rejected memories are pruned.

**Alternatives considered:**
- File-first store (v1 atoms pattern): markdown as source of truth — rejected for `memories` because the DB enables atomic writes, dedup, and decay scoring that file ops cannot safely provide.
- Hard-delete on merge: simpler but loses audit history and makes the consolidate/distill operations irreversible.
- No review gate: auto-approve all extractions — rejected because Haiku occasionally extracts noise; the review queue lets humans catch low-confidence or incorrect memories before they pollute recall.

**Reason:** Non-destructive decay lets memories "come back" when verified rather than requiring re-extraction. The review gate is the quality control valve — it keeps recall signal-to-noise high without requiring every extraction to be perfect. Content-addressed IDs make the pipeline idempotent: re-running the Reflector over the same transcript produces no duplicate rows.

---

## DDR-002 — Capture pipeline design: Observer gate + per-session cursor for cheap idempotency

**Decision:** The Reflector reads only transcript lines added since `sessions.last_reflected_index` (the per-session cursor). Before calling the LLM, an Observer gate checks for signal: the window must have ≥1 user message, ≥4 exchanges, a tool error, or a correction/preference marker phrase — trivial windows skip the LLM call entirely. The capture hooks (`Stop` / `PreCompact` / `SessionEnd`) always spawn `runner.js` detached and exit 0 — a capture failure never disrupts a session. Recall (`load-runner.js`) is registered as a direct `SessionStart` command (needs stdout for `additionalContext`), runs synchronously, best-effort.

**Alternatives:** Session-level dedup only (hash whole transcript) — coarser than the cursor; doesn't handle incremental captures during long sessions. Blocking capture — unacceptable; session hooks must not stall Claude Code startup/shutdown.

**Reason:** The cursor + Observer gate means frequent `Stop` events (e.g. from tool calls) are nearly free. The detached spawn pattern isolates capture failures from session lifecycle. The asymmetry between capture (detached) and recall (direct command) reflects their different latency requirements.

---

## DDR-003 — Recall ranking: effective confidence × help-rate with load_at_init bypass

**Decision:** Recall ranks memories by `effectiveConfidence × helpRate` where `helpRate = help_count / use_count` (defaults to 1.0 when `use_count = 0`). `load_at_init = 1` memories sort first and bypass the `min_confidence` threshold. The budget walk emits full bodies until `max_tokens` is reached, then titles-only for the remainder. Project-scoped and global/shared memories are queried in a dual bank — both contribute to the ranked list.

**Alternatives:** Recency-only ranking — ignores whether a memory actually helped. Confidence-only — ignores feedback signal. Separate budgets for project vs global memories — more complex for marginal benefit.

**Reason:** The `help_count / use_count` signal closes the loop: memories that consistently help get recalled more; memories that don't decay out. The `load_at_init` bypass gives operators an escape hatch for critical conventions that must always appear regardless of decay state.

<!-- Append DDR-004, DDR-005, … below. Format: Decision / Alternatives / Reason. -->

## DDR-004 — Capture quality thresholds: observer gate signals, cosine dedup, and approval gate

**Decision:** Three numeric thresholds govern capture quality, all configurable in `extraction_models.yaml`:

1. **Observer gate signals** — before calling the LLM, the Reflector checks: ≥1 user message in the window, ≥4 exchanges total, presence of a tool error, or a correction/preference marker phrase. All four are OR-conditions; any one triggers extraction. Windows that satisfy none skip the LLM call entirely.

2. **Semantic dedup threshold** (`capture.dedup_cosine_threshold`, default 0.86)** — after embedding a new candidate memory, a KNN query finds existing memories. Cosine ≥ 0.86 = near-duplicate: the existing memory's `last_verified_at` is touched (re-verified) and the candidate is not inserted. This is the same threshold used by `linkAtom`/`linkMemory` for `duplicates` links (ADR-003).

3. **Auto-approval threshold** (`capture.auto_approve_confidence`, default 0.85)** — candidates with extraction confidence ≥ 0.85 are inserted with `review_status='approved'` and enter recall immediately. Below 0.85, they land in `review_status='pending'` and are excluded from recall until approved in the Review view (DDR-001).

**Alternatives considered:**
- Fixed thresholds baked into code — rejected; early tuning showed the right values depend on corpus size and model behaviour, so they must be configurable without a rebuild.
- Single threshold for both dedup and approval — different concerns: dedup is a vector similarity question; approval is an extraction confidence question. They happened to converge near 0.85–0.86 but are conceptually independent.

**Reason:** The three-gate design means the LLM is called only when there is likely signal (observer gate), duplicates are caught semantically not just lexically (cosine dedup), and low-confidence extractions never corrupt recall without human review (approval gate).
