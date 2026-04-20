<script lang="ts">
  import { api, type DashboardData } from "../lib/api";
  import { navigate } from "../lib/router";
  import { poll, POLL } from "../lib/poll";

  let data: DashboardData | null = $state(null);
  let error: string | null = $state(null);

  async function load() {
    try {
      data = await api.dashboard();
      error = null;
    } catch (e: any) {
      error = e.message;
    }
  }

  $effect(() => {
    const stop = poll(load, POLL.NORMAL);
    return stop;
  });
</script>

<div class="page">
  <h1 class="page-title">Dashboard</h1>

  {#if error}
    <div class="card error-card">
      <p>Could not connect to API: {error}</p>
      <p class="hint">Run <code>npm run dev:api</code> to start the backend.</p>
    </div>
  {:else if !data}
    <p class="loading">Loading...</p>
  {:else}
    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-value">{data.projects.length}</span>
        <span class="stat-label">Projects</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{data.totalSessions}</span>
        <span class="stat-label">Sessions</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{data.totalMemories}</span>
        <span class="stat-label">Memory Atoms</span>
      </div>
    </div>

    <section class="section">
      <h2 class="section-title">Recent Sessions</h2>
      <div class="session-list">
        {#each data.recentSessions.slice(0, 8) as session}
          <button class="session-card" onclick={() => navigate("sessions", { id: session.id })}>
            <div class="session-header">
              <span class="status-dot status-{session.status}"></span>
              <span class="session-title">{session.title}</span>
            </div>
            <div class="session-meta">
              <span class="session-project">{session.project}</span>
              <span class="sep">·</span>
              <span>{session.messageCount} msgs</span>
              <span class="sep">·</span>
              <span>{new Date(session.lastActivity).toLocaleDateString()}</span>
            </div>
            {#if session.pendingPrompt}
              <div class="pending-badge">Waiting for input</div>
            {/if}
          </button>
        {/each}
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Projects</h2>
      <div class="project-grid">
        {#each data.projects as proj}
          <button class="project-card" onclick={() => navigate("memories", { project: proj.project })}>
            <span class="project-name">{proj.project}</span>
            <div class="project-meta">
              <span>{proj.sessions} sessions</span>
              <span class="sep">·</span>
              <span>{proj.memories} memories</span>
            </div>
          </button>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .page { max-width: 960px; }
  .page-title {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin-bottom: 24px;
  }

  .stats-row {
    display: flex;
    gap: 16px;
    margin-bottom: 32px;
  }

  .stat-card {
    flex: 1;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-value {
    font-size: 32px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }

  .stat-label {
    font-size: 13px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .section { margin-bottom: 32px; }
  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--text-secondary);
  }

  .session-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .session-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 14px 16px;
    cursor: pointer;
    transition: border-color 0.15s;
    text-align: left;
    width: 100%;
    color: var(--text-primary);
    font-family: var(--font-sans);
  }

  .session-card:hover { border-color: var(--border); }

  .session-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-active { background: var(--success); }
  .status-idle { background: var(--text-muted); }
  .status-waiting { background: var(--warning); animation: pulse 2s ease-in-out infinite; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .session-title { font-weight: 600; font-size: 14px; }
  .session-project { font-size: 12px; color: var(--text-secondary); }

  .session-meta {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    gap: 4px;
  }

  .pending-badge {
    display: inline-block;
    margin-top: 6px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(251, 191, 36, 0.12);
    color: var(--warning);
    border-radius: 4px;
  }

  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }

  .project-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 16px;
    cursor: pointer;
    transition: border-color 0.15s;
    text-align: left;
    color: var(--text-primary);
    font-family: var(--font-sans);
  }

  .project-card:hover { border-color: var(--border); }
  .project-name { font-weight: 600; font-size: 14px; display: block; margin-bottom: 4px; }
  .project-meta { font-size: 12px; color: var(--text-muted); display: flex; gap: 4px; }
  .sep { color: var(--text-muted); }

  .error-card {
    background: rgba(248, 113, 113, 0.06);
    border: 1px solid rgba(248, 113, 113, 0.2);
    border-radius: var(--radius-md);
    padding: 20px;
  }

  .hint { margin-top: 8px; color: var(--text-muted); font-size: 13px; }
  .hint code {
    background: var(--bg-elevated);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  .loading { color: var(--text-muted); }

  .card { /* base */ }
</style>
