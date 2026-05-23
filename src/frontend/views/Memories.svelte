<script lang="ts">
  import { api, type Memory, type MemoryType, type MemoryScope } from "../lib/api";
  import { poll, POLL } from "../lib/poll";

  const MEMORY_TYPES: MemoryType[] = [
    "preference", "convention", "failure", "correction",
    "decision", "insight", "tool_quirk", "reference", "handoff",
  ];
  const SCOPES: MemoryScope[] = ["global", "shared", "project"];
  const PAGE_SIZE = 100;

  let memories: Memory[] = $state([]);
  let total = $state(0);
  let offset = $state(0);
  let error: string | null = $state(null);
  let loading = $state(false);

  // Filters
  let filterType: string = $state("");
  let filterScope: string = $state("");
  let textFilter: string = $state("");

  // Per-memory UI state
  let expanded: Set<string> = $state(new Set());
  let editingId: string | null = $state(null);
  let editTitle: string = $state("");
  let editBody: string = $state("");
  let editTags: string = $state("");
  let savingId: string | null = $state(null);
  let confirmDeleteId: string | null = $state(null);
  let busyId: string | null = $state(null);

  // Consolidate
  let consolidating = $state(false);
  let consolidateResult: { embedded: number; merged: number; pruned: number } | null = $state(null);

  // Distill
  let distilling = $state(false);
  let distillResult: { clusters: number; created: number; merged: number; sanitized: number } | null = $state(null);

  const visible = $derived.by(() => {
    const q = textFilter.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  });

  function isDecaying(m: Memory): boolean {
    return m.effective_confidence < m.confidence * 0.6;
  }

  async function load(reset = true) {
    loading = true;
    try {
      if (reset) offset = 0;
      const res = await api.memories({
        memory_type: (filterType || undefined) as MemoryType | undefined,
        scope: (filterScope || undefined) as MemoryScope | undefined,
        limit: PAGE_SIZE,
        offset: reset ? 0 : offset,
      });
      memories = reset ? res.memories : [...memories, ...res.memories];
      total = res.total;
      error = null;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    offset += PAGE_SIZE;
    await load(false);
  }

  function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  async function verify(m: Memory) {
    busyId = m.id;
    try {
      await api.verifyMemory(m.id);
      const fresh = await api.memory(m.id);
      memories = memories.map((x) => (x.id === m.id ? fresh : x));
    } catch (e: any) {
      error = e.message;
    } finally {
      busyId = null;
    }
  }

  function startEdit(m: Memory) {
    editingId = m.id;
    editTitle = m.title;
    editBody = m.body;
    editTags = m.tags.join(", ");
  }

  function cancelEdit() {
    editingId = null;
  }

  async function saveEdit(m: Memory) {
    savingId = m.id;
    try {
      const updated = await api.updateMemory(m.id, {
        title: editTitle.trim(),
        body: editBody,
        tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      memories = memories.map((x) => (x.id === m.id ? updated : x));
      editingId = null;
    } catch (e: any) {
      error = e.message;
    } finally {
      savingId = null;
    }
  }

  async function remove(m: Memory) {
    busyId = m.id;
    try {
      await api.deleteMemory(m.id);
      memories = memories.filter((x) => x.id !== m.id);
      total = Math.max(0, total - 1);
      confirmDeleteId = null;
    } catch (e: any) {
      error = e.message;
    } finally {
      busyId = null;
    }
  }

  async function runConsolidate() {
    consolidating = true;
    consolidateResult = null;
    try {
      consolidateResult = await api.consolidate();
      await load(true);
    } catch (e: any) {
      error = e.message;
    } finally {
      consolidating = false;
    }
  }

  async function runDistill() {
    distilling = true;
    distillResult = null;
    try {
      distillResult = await api.distill();
      await load(true);
    } catch (e: any) {
      error = e.message;
    } finally {
      distilling = false;
    }
  }

  $effect(() => {
    const stop = poll(() => load(true), POLL.NORMAL);
    return stop;
  });

  // Re-load on filter change
  $effect(() => {
    filterType;
    filterScope;
    load(true);
  });
</script>

<div class="page">
  <div class="toolbar">
    <h1 class="page-title">Memories</h1>
    <div class="filters">
      <select class="filter-select" bind:value={filterType}>
        <option value="">All types</option>
        {#each MEMORY_TYPES as t}
          <option value={t}>{t}</option>
        {/each}
      </select>
      <select class="filter-select" bind:value={filterScope}>
        <option value="">All scopes</option>
        {#each SCOPES as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
      <input class="text-filter" placeholder="Filter text…" bind:value={textFilter} />
    </div>
    <button class="btn-consolidate" onclick={runConsolidate} disabled={consolidating || distilling}>
      {consolidating ? "Consolidating…" : "Consolidate"}
    </button>
    <button class="btn-consolidate" onclick={runDistill} disabled={distilling || consolidating}>
      {distilling ? "Distilling…" : "Distill"}
    </button>
  </div>

  {#if consolidateResult}
    <p class="consolidate-result">
      Consolidation done — embedded {consolidateResult.embedded},
      merged {consolidateResult.merged}, pruned {consolidateResult.pruned}.
    </p>
  {/if}

  {#if distillResult}
    <p class="consolidate-result">
      Distill done — {distillResult.clusters} cluster(s) → {distillResult.created} consolidated,
      {distillResult.merged} folded in, {distillResult.sanitized} tightened.
    </p>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <div class="count-bar">
    Showing {visible.length} of {total}
  </div>

  <div class="memory-list">
    {#each visible as m (m.id)}
      <div class="memory-card" class:decaying={isDecaying(m)}>
        {#if editingId === m.id}
          <!-- Edit mode -->
          <input class="edit-title" bind:value={editTitle} placeholder="Title" />
          <textarea class="edit-body" bind:value={editBody} rows="6"></textarea>
          <input class="edit-tags" bind:value={editTags} placeholder="Tags (comma-separated)" />
          <div class="card-actions">
            <button class="btn btn-save" onclick={() => saveEdit(m)} disabled={savingId === m.id}>
              {savingId === m.id ? "Saving…" : "Save"}
            </button>
            <button class="btn btn-cancel" onclick={cancelEdit} disabled={savingId === m.id}>Cancel</button>
          </div>
        {:else}
          <!-- View mode -->
          <div class="card-head">
            <span class="type-badge type-{m.memory_type}">{m.memory_type}</span>
            <span class="scope-badge">{m.scope}</span>
            {#if isDecaying(m)}
              <span class="decay-badge" title="effective confidence dropped well below intrinsic — needs reverification">
                ⚠ decaying
              </span>
            {/if}
            <span class="confidence" title="effective / intrinsic confidence">
              <span class="conf-bar">
                <span class="conf-fill" style="width: {Math.round(m.effective_confidence * 100)}%"></span>
              </span>
              {Math.round(m.effective_confidence * 100)}%
              {#if isDecaying(m)}
                <span class="conf-intrinsic">(was {Math.round(m.confidence * 100)}%)</span>
              {/if}
            </span>
          </div>

          <h3 class="card-title">{m.title}</h3>

          {#if m.project}
            <span class="card-project">{m.project}</span>
          {/if}

          <div class="card-body" class:clamped={!expanded.has(m.id)}>{m.body}</div>
          {#if m.body.length > 200}
            <button class="expand-btn" onclick={() => toggleExpand(m.id)}>
              {expanded.has(m.id) ? "Show less" : "Show more"}
            </button>
          {/if}

          {#if m.tags.length > 0}
            <div class="card-tags">
              {#each m.tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          {/if}

          {#if confirmDeleteId === m.id}
            <div class="confirm-row">
              <span>Delete this memory permanently?</span>
              <button class="btn btn-confirm-delete" onclick={() => remove(m)} disabled={busyId === m.id}>
                {busyId === m.id ? "Deleting…" : "Yes, delete"}
              </button>
              <button class="btn btn-cancel" onclick={() => (confirmDeleteId = null)}>Cancel</button>
            </div>
          {:else}
            <div class="card-actions">
              <button class="btn btn-verify" onclick={() => verify(m)} disabled={busyId === m.id}>
                {busyId === m.id ? "…" : "Verify"}
              </button>
              <button class="btn btn-edit" onclick={() => startEdit(m)}>Edit</button>
              <button class="btn btn-delete" onclick={() => (confirmDeleteId = m.id)}>Delete</button>
            </div>
          {/if}
        {/if}
      </div>
    {/each}

    {#if visible.length === 0 && !loading && !error}
      <p class="empty">No memories match the current filters.</p>
    {/if}
  </div>

  {#if memories.length < total}
    <button class="btn-load-more" onclick={loadMore} disabled={loading}>
      {loading ? "Loading…" : `Load more (${total - memories.length} remaining)`}
    </button>
  {/if}
</div>

<style>
  .page {
    height: calc(100vh - 56px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .page-title { font-size: 18px; font-weight: 700; flex-shrink: 0; }

  .filters { display: flex; gap: 8px; align-items: center; flex: 1; }

  .filter-select {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .text-filter {
    flex: 1;
    max-width: 260px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
  }

  .btn-consolidate {
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 7px 14px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .btn-consolidate:hover:not(:disabled) { opacity: 0.85; }
  .btn-consolidate:disabled { opacity: 0.5; cursor: not-allowed; }

  .consolidate-result {
    font-size: 12px;
    color: var(--success);
    background: rgba(74, 222, 128, 0.08);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    flex-shrink: 0;
  }

  .count-bar {
    font-size: 12px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .memory-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .memory-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .memory-card.decaying {
    border-color: var(--warning);
    background: rgba(251, 191, 36, 0.04);
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .type-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--accent-bg);
    color: var(--accent);
  }
  .type-failure, .type-correction { background: rgba(248, 113, 113, 0.15); color: var(--error); }
  .type-preference, .type-convention { background: rgba(96, 165, 250, 0.15); color: var(--info); }
  .type-decision, .type-insight { background: rgba(192, 132, 252, 0.15); color: var(--accent); }
  .type-tool_quirk { background: rgba(251, 191, 36, 0.15); color: var(--warning); }
  .type-reference, .type-handoff { background: rgba(74, 222, 128, 0.15); color: var(--success); }

  .scope-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    text-transform: uppercase;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .decay-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(251, 191, 36, 0.18);
    color: var(--warning);
  }

  .confidence {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .conf-bar {
    width: 60px;
    height: 5px;
    background: var(--bg-hover);
    border-radius: 3px;
    overflow: hidden;
  }
  .conf-fill {
    display: block;
    height: 100%;
    background: var(--success);
    border-radius: 3px;
  }
  .decaying .conf-fill { background: var(--warning); }
  .conf-intrinsic { color: var(--text-muted); opacity: 0.7; }

  .card-title { font-size: 14px; font-weight: 600; line-height: 1.4; }

  .card-project {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .card-body {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .card-body.clamped {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .expand-btn {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--accent);
    font-family: var(--font-sans);
    font-size: 12px;
    cursor: pointer;
    padding: 0;
  }
  .expand-btn:hover { text-decoration: underline; }

  .card-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .tag {
    font-size: 10px;
    background: var(--accent-bg);
    color: var(--accent);
    padding: 1px 6px;
    border-radius: 3px;
  }

  .card-actions { display: flex; gap: 8px; }

  .confirm-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--error);
    padding: 8px;
    background: rgba(248, 113, 113, 0.08);
    border-radius: var(--radius-sm);
  }

  .btn {
    padding: 5px 14px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-verify { background: rgba(74, 222, 128, 0.12); color: var(--success); border-color: var(--success); }
  .btn-verify:hover:not(:disabled) { background: var(--success); color: var(--bg-base); }

  .btn-edit { background: var(--accent-bg); color: var(--accent); border-color: var(--accent-dim); }
  .btn-edit:hover { background: var(--accent-dim); color: white; }

  .btn-delete { background: none; color: var(--text-muted); border-color: var(--border); }
  .btn-delete:hover { color: var(--error); border-color: var(--error); }

  .btn-save { background: var(--accent); color: white; border-color: var(--accent); }
  .btn-save:hover:not(:disabled) { opacity: 0.85; }

  .btn-cancel { background: none; color: var(--text-secondary); border-color: var(--border); }
  .btn-cancel:hover:not(:disabled) { background: var(--bg-hover); }

  .btn-confirm-delete { background: var(--error); color: white; border-color: var(--error); }
  .btn-confirm-delete:hover:not(:disabled) { opacity: 0.85; }

  .edit-title {
    background: var(--bg-elevated);
    border: 1px solid var(--accent-dim);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    outline: none;
  }
  .edit-body {
    background: var(--bg-elevated);
    border: 1px solid var(--accent-dim);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    padding: 10px;
    border-radius: var(--radius-sm);
    resize: vertical;
    outline: none;
  }
  .edit-tags {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    outline: none;
  }

  .btn-load-more {
    align-self: center;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 8px 20px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    margin: 8px 0;
  }
  .btn-load-more:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  .btn-load-more:disabled { opacity: 0.5; cursor: not-allowed; }

  .error {
    color: var(--error);
    font-size: 13px;
    padding: 8px;
    background: rgba(248, 113, 113, 0.1);
    border-radius: var(--radius-sm);
  }
  .empty { color: var(--text-muted); padding: 24px; font-size: 13px; text-align: center; }
</style>
