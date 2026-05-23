<script lang="ts">
  import { api, type Memory, type ReviewStatus } from "../lib/api";
  import { poll, POLL } from "../lib/poll";
  import { pendingReviewCount } from "../lib/reviewStore";
  import { navigate } from "../lib/router";

  let memories: Memory[] = $state([]);
  let error: string | null = $state(null);
  let busyId: string | null = $state(null);

  async function load() {
    try {
      const res = await api.memories({ review_status: "pending", limit: 100 });
      memories = res.memories;
      pendingReviewCount.set(res.total);
      error = null;
    } catch (e: any) {
      error = e.message;
    }
  }

  async function review(m: Memory, status: ReviewStatus) {
    busyId = m.id;
    try {
      await api.reviewMemory(m.id, status);
      memories = memories.filter((x) => x.id !== m.id);
      pendingReviewCount.update((n) => Math.max(0, n - 1));
    } catch (e: any) {
      error = e.message;
    } finally {
      busyId = null;
    }
  }

  $effect(() => {
    const stop = poll(load, POLL.NORMAL);
    return stop;
  });
</script>

<div class="page">
  <div class="toolbar">
    <h1 class="page-title">Review Queue</h1>
    <span class="count">{memories.length} pending</span>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if memories.length === 0 && !error}
    <div class="empty-state">
      <span class="empty-icon">✓</span>
      <p>Review queue is clear — no memories awaiting approval.</p>
    </div>
  {:else}
    <div class="review-list">
      {#each memories as m (m.id)}
        <div class="review-card">
          <div class="card-head">
            <span class="type-badge type-{m.memory_type}">{m.memory_type}</span>
            <span class="scope-badge">{m.scope}</span>
            <span class="confidence">{Math.round(m.confidence * 100)}% confidence</span>
          </div>

          <h3 class="card-title">{m.title}</h3>
          <div class="card-body">{m.body}</div>

          {#if m.source_session_id}
            <button
              class="source-link"
              onclick={() => navigate("sessions", { id: m.source_session_id })}
              title="View source session"
            >
              source: {m.source_session_id.slice(0, 12)}…
            </button>
          {/if}

          <div class="card-actions">
            <button
              class="btn btn-approve"
              onclick={() => review(m, "approved")}
              disabled={busyId === m.id}
            >
              {busyId === m.id ? "…" : "Approve"}
            </button>
            <button
              class="btn btn-reject"
              onclick={() => review(m, "rejected")}
              disabled={busyId === m.id}
            >
              {busyId === m.id ? "…" : "Reject"}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    height: calc(100vh - 56px);
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
  }

  .toolbar { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .page-title { font-size: 18px; font-weight: 700; }
  .count {
    font-size: 12px;
    font-weight: 600;
    color: var(--warning);
    background: rgba(251, 191, 36, 0.12);
    padding: 3px 10px;
    border-radius: 12px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 64px 0;
    color: var(--text-muted);
  }
  .empty-icon {
    font-size: 32px;
    color: var(--success);
  }

  .review-list { display: flex; flex-direction: column; gap: 10px; }

  .review-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

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

  .confidence {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .card-title { font-size: 14px; font-weight: 600; line-height: 1.4; }

  .card-body {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .source-link {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
  }
  .source-link:hover { color: var(--accent); text-decoration: underline; }

  .card-actions { display: flex; gap: 8px; }

  .btn {
    padding: 6px 18px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-approve { background: rgba(74, 222, 128, 0.12); color: var(--success); border-color: var(--success); }
  .btn-approve:hover:not(:disabled) { background: var(--success); color: var(--bg-base); }

  .btn-reject { background: none; color: var(--text-muted); border-color: var(--border); }
  .btn-reject:hover:not(:disabled) { color: var(--error); border-color: var(--error); }

  .error {
    color: var(--error);
    font-size: 13px;
    padding: 8px;
    background: rgba(248, 113, 113, 0.1);
    border-radius: var(--radius-sm);
  }
</style>
