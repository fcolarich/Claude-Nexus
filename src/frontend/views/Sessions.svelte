<script lang="ts">
  import { api, type SessionInfo } from "../lib/api";
  import { poll, POLL } from "../lib/poll";

  let sessions: SessionInfo[] = $state([]);
  let filter: "all" | "active" | "waiting" | "idle" = $state("all");
  let error: string | null = $state(null);
  let editingId: string | null = $state(null);
  let editValue: string = $state("");

  const filtered = $derived(
    filter === "all" ? sessions : sessions.filter((s) => s.status === filter)
  );

  const counts = $derived({
    all: sessions.length,
    active: sessions.filter((s) => s.status === "active").length,
    waiting: sessions.filter((s) => s.status === "waiting").length,
    idle: sessions.filter((s) => s.status === "idle").length,
  });

  async function load() {
    try {
      sessions = await api.sessions();
      error = null;
    } catch (e: any) {
      error = e.message;
    }
  }

  function startRename(session: SessionInfo) {
    editingId = session.id;
    editValue = session.title;
  }

  async function saveRename(id: string) {
    if (editValue.trim()) {
      try {
        await api.renameSession(id, editValue.trim());
        await load();
      } catch {}
    }
    editingId = null;
  }

  $effect(() => {
    const stop = poll(load, POLL.FAST);
    return stop;
  });
</script>

<div class="page">
  <h1 class="page-title">Sessions</h1>

  <div class="filters">
    {#each ["all", "active", "waiting", "idle"] as f}
      <button
        class="filter-chip"
        class:active={filter === f}
        onclick={() => (filter = f as any)}
      >
        {f} <span class="chip-count">{counts[f as keyof typeof counts]}</span>
      </button>
    {/each}
  </div>

  {#if error}
    <p class="error">API unavailable: {error}</p>
  {:else}
    <div class="session-list">
      {#each filtered as session}
        <div class="session-row">
          <span class="status-dot status-{session.status}"></span>
          <div class="session-info">
            {#if editingId === session.id}
              <input
                class="rename-input"
                bind:value={editValue}
                onkeydown={(e) => { if (e.key === 'Enter') saveRename(session.id); if (e.key === 'Escape') editingId = null; }}
                onblur={() => saveRename(session.id)}
              />
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="session-title" ondblclick={() => startRename(session)} title="Double-click to rename">{session.title}</span>
            {/if}
            <span class="session-meta-line">
              <span class="session-project">{session.project}</span>
              <span class="sep">·</span>
              <span class="session-id">{session.id.slice(0, 8)}</span>
            </span>
          </div>
          <div class="session-detail">
            <span>{session.messageCount} msgs</span>
            <span class="sep">·</span>
            <span>{new Date(session.lastActivity).toLocaleString()}</span>
          </div>
          {#if session.pendingPrompt}
            <div class="pending">
              <span class="pending-badge">Waiting</span>
              <span class="pending-text">{session.pendingPrompt.slice(0, 80)}{session.pendingPrompt.length > 80 ? "..." : ""}</span>
            </div>
          {/if}
        </div>
      {/each}
      {#if filtered.length === 0}
        <p class="empty">No {filter === "all" ? "" : filter} sessions found.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 960px; }
  .page-title {
    font-size: 24px; font-weight: 700;
    letter-spacing: -0.03em; margin-bottom: 20px;
  }

  .filters { display: flex; gap: 8px; margin-bottom: 20px; }

  .filter-chip {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: none;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    text-transform: capitalize;
  }

  .filter-chip:hover { border-color: var(--text-muted); }
  .filter-chip.active {
    background: var(--accent-bg);
    border-color: var(--accent-dim);
    color: var(--accent);
  }

  .chip-count {
    font-variant-numeric: tabular-nums;
    margin-left: 4px;
    opacity: 0.7;
  }

  .session-list { display: flex; flex-direction: column; gap: 6px; }

  .session-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    flex-wrap: wrap;
  }

  .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .status-active { background: var(--success); }
  .status-idle { background: var(--text-muted); }
  .status-waiting { background: var(--warning); animation: pulse 2s ease-in-out infinite; }

  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .session-info { display: flex; flex-direction: column; min-width: 220px; flex: 1; }
  .session-title { font-weight: 600; font-size: 14px; cursor: default; }
  .session-title:hover { color: var(--accent); }
  .session-meta-line { display: flex; gap: 4px; align-items: center; }
  .session-project { font-size: 12px; color: var(--text-secondary); }
  .session-id { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

  .rename-input {
    font-weight: 600; font-size: 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--accent-dim);
    border-radius: 4px;
    padding: 2px 6px;
    color: var(--text-primary);
    font-family: var(--font-sans);
    outline: none;
    width: 100%;
  }

  .session-detail { font-size: 12px; color: var(--text-muted); display: flex; gap: 4px; margin-left: auto; }
  .sep { color: var(--text-muted); }

  .pending {
    width: 100%;
    margin-top: 4px;
    padding-left: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pending-badge {
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(251, 191, 36, 0.12);
    color: var(--warning);
    border-radius: 4px;
    flex-shrink: 0;
  }

  .pending-text { font-size: 12px; color: var(--text-secondary); }
  .error { color: var(--error); }
  .empty { color: var(--text-muted); padding: 20px; text-align: center; }
</style>
