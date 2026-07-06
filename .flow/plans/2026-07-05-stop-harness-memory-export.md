# Stop Harness Memory-Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `dispatch-agents` skill to implement this plan task-by-task.
>
> **Branching note:** This project branches in place — do NOT use `git-worktrees` (hook execution paths are hardcoded to `C:\Fran\claude-nexus`; see project memory `d71a479e`/`0518e65a`). Create a normal local branch before Task 1 and hand off to `finish-branch` at the end.

**Goal:** Stop Claude Nexus's `exportAll()` from writing memory files into `~/.claude/projects/<project>/memory` — the directory Claude Code's own built-in auto-memory feature auto-loads in full at every session start — since `prompt-runner.ts` already provides per-prompt, relevance-floored recall directly from the DB, making the full unfiltered dump redundant (and it just exceeded Claude Code's 24.4KB MEMORY.md load limit).

**Architecture:** One-line config change (`capture.export_dir` reverts to the code's existing Nexus-owned sandbox default, `~/.claude/memories/exports` — no source changes needed for the fix itself), a one-time filesystem cleanup of the 30 already-populated `memory/` folders under `~/.claude/projects/*`, a stale-comment fix in `export.ts`, and a follow-up ADR recording the reversal. Nothing reads exported markdown back into Nexus (`nexus_recall`/`nexus_search`/dashboard all query the DB directly), so this is a delivery-mechanism change only — no retrieval path is affected.

**Tech Stack:** TypeScript (no code logic changes), YAML config, PowerShell (cleanup), markdown (ADR).

---

### Task 1: Branch in place

**Step 1:** Create a local branch (no worktree, per project convention):

```powershell
git checkout -b fix/stop-harness-memory-export
```

**Step 2: Verify**

Run: `git branch --show-current`
Expected: `fix/stop-harness-memory-export`

---

### Task 2: Remove the harness-path override from extraction_models.yaml

**Files:**
- Modify: `extraction_models.yaml:36-41`

**Step 1: Implement**

Current (lines 36-41):

```yaml
# Capture — Reflector write thresholds + markdown export target.
capture:
  auto_approve_confidence: 0.85 # >= this is stored approved; below = pending review
  dedup_cosine_threshold: 0.86  # a candidate this similar to an existing memory = merge
  # Where the DB→markdown export writes. A leading ~/ is expanded to your home dir.
  # Cutover complete (2026-05-29): exports write directly to the harness memory dir.
  export_dir: ~/.claude/projects
```

Replace with:

```yaml
# Capture — Reflector write thresholds + markdown export target.
capture:
  auto_approve_confidence: 0.85 # >= this is stored approved; below = pending review
  dedup_cosine_threshold: 0.86  # a candidate this similar to an existing memory = merge
  # export_dir intentionally omitted here — falls back to the code default in
  # src/core/config.ts (~/.claude/memories/exports), a Nexus-owned sandbox.
  # Do NOT point this at ~/.claude/projects: that is Claude Code's own
  # auto-memory directory, auto-loaded in full at every session start, which
  # duplicates and conflicts with prompt-runner's per-prompt relevance-floored
  # recall. See _documents/decisions/ for the ADR on this reversal.
```

**Step 2: Verify**

Run:
```powershell
Select-String -Path extraction_models.yaml -Pattern "export_dir"
```
Expected: no match (the key is no longer present, so `getNexusConfig()` falls back to the default).

Then confirm the default resolves correctly:
```powershell
node -e "const {getNexusConfig}=require('./dist/core/config.js'); console.log(getNexusConfig().capture.export_dir)"
```
Expected output: a path ending in `\.claude\memories\exports` (home-expanded). If `dist/` is stale, run `npm run build` first (or `npx tsc`) then re-run.

**Step 3: Commit**

```bash
git add extraction_models.yaml
git commit -m "fix: stop exporting memories into Claude Code's native auto-memory dir"
```

---

### Task 3: Fix the stale comment in export.ts

**Files:**
- Modify: `src/capture/export.ts:1-8`

**Step 1: Implement**

Current (lines 1-8):

```typescript
/**
 * Markdown export — materializes approved memories from the DB to disk.
 *
 * The DB is the system of record; this regenerates a human-readable mirror.
 * Phase 2 writes to capture.export_dir (a Nexus-owned sandbox). The deliberate
 * cutover repoints export_dir at ~/.claude/projects/<project>/memory once
 * capture is verified — only then does the harness load DB-generated memory.
 */
```

Replace with:

```typescript
/**
 * Markdown export — materializes approved memories from the DB to disk.
 *
 * The DB is the system of record; this regenerates a human-readable mirror
 * under capture.export_dir (a Nexus-owned sandbox, default
 * ~/.claude/memories/exports). Deliberately NOT ~/.claude/projects/<project>/memory:
 * that directory is auto-loaded in full by Claude Code's own native
 * auto-memory feature at every session start, which would duplicate and
 * conflict with prompt-runner's per-prompt relevance-floored recall.
 */
```

**Step 2: Verify**

Run: `Select-String -Path src\capture\export.ts -Pattern "Phase 2|cutover"`
Expected: no match.

**Step 3: Commit**

```bash
git add src/capture/export.ts
git commit -m "docs: correct stale export_dir comment in export.ts"
```

---

### Task 4: Delete existing memory/ exports under ~/.claude/projects

This is a filesystem-only cleanup — no DB involved. Nexus exclusively owns the `memory/` subdir under each project folder (never touches sibling files like the session `.jsonl`), so deleting it wholesale is safe. This step is destructive and touches 30 project directories outside this repo — re-confirm the exact list immediately before deleting.

**Step 1: Re-list every memory/ folder Nexus wrote (confirm nothing unexpected changed since planning)**

```powershell
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Directory | ForEach-Object {
  $m = Join-Path $_.FullName 'memory'
  if (Test-Path $m) {
    $count = (Get-ChildItem $m -Filter *.md -File | Measure-Object).Count
    [PSCustomObject]@{Project=$_.Name; Path=$m; Files=$count}
  }
} | Format-Table -AutoSize
```

Expected: the same ~30 rows seen during planning (`_global` 2717, `LLM-Workflow-Optimization` 1478, `Voodoo-Magic` 1142, `IntoTheEndlessSea` 669, `Automatic-Encyclopedias` 984, `claude-nexus` 124, plus ~24 smaller ones). If a project's `Files` count is much larger than expected or a wholly new project appears, stop and investigate before deleting (may indicate concurrent capture activity).

**Step 2: Delete each listed memory/ folder**

```powershell
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Directory | ForEach-Object {
  $m = Join-Path $_.FullName 'memory'
  if (Test-Path $m) {
    Remove-Item $m -Recurse -Force -Confirm:$false
    Write-Output "Deleted: $m"
  }
}
```

**Step 3: Verify**

```powershell
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Directory | ForEach-Object {
  $m = Join-Path $_.FullName 'memory'
  if (Test-Path $m) { Write-Output "STILL PRESENT: $m" }
}
```
Expected: no output (all `memory/` folders removed). Sibling files (e.g. each project's `.jsonl` session logs) must remain untouched — spot-check one:
```powershell
Get-ChildItem "$env:USERPROFILE\.claude\projects\C--Fran-claude-nexus"
```
Expected: still shows the project's other files/folders, just no `memory` directory.

**Step 4: No commit** (nothing in this step touches the git repo — it's outside the working tree).

---

### Task 5: Regenerate exports at the new sandbox location

**Files:** none (verification only)

**Step 1:** Run the CLI export command (after building if needed):

```powershell
npm run build
node dist/cli/index.js export
```

(If `nexus` is installed globally/linked, `nexus export` also works — check `package.json` `bin` field if unsure which invocation applies.)

**Step 2: Verify**

```powershell
Get-ChildItem "$env:USERPROFILE\.claude\memories\exports\C--Fran-claude-nexus\memory" -Filter MEMORY.md
```
Expected: `MEMORY.md` exists at that new path. Also confirm the old harness path was NOT recreated:
```powershell
Test-Path "$env:USERPROFILE\.claude\projects\C--Fran-claude-nexus\memory"
```
Expected: `False`.

**Step 3: No commit** (generated export files are not part of the git repo).

---

### Task 6: Hand off to finish-branch

Implementation and manual verification are complete. Before finishing:

- Note for the doc-update step: after `finish-branch`, invoke the `add-adr` skill to record this reversal (title suggestion: "Stop piggybacking memory export on Claude Code's native auto-memory directory"). Content: supersedes the informal, comment-only "cutover" that previously repointed `capture.export_dir` at `~/.claude/projects/<project>/memory`; reason is that `prompt-runner.ts` (ADR-009) already provides per-prompt relevance-floored recall directly from the DB, making an unfiltered full-dump loaded at every session start redundant — and it exceeded Claude Code's 24.4KB memory-file load limit. Also mention the one-time cleanup of `~/.claude/projects/*/memory/` performed during this change.

Invoke the `finish-branch` skill now to merge `fix/stop-harness-memory-export` back to `main` (or present the merge/PR/keep/discard options per that skill's normal flow).
