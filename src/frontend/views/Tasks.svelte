<script lang="ts">
  import { api, type TaskItem, type TaskStatus, type CreateTaskParams } from "../lib/api";
  import { poll, POLL } from "../lib/poll";

  let tasks: TaskItem[] = $state([]);
  let projects: string[] = $state([]);
  let error: string | null = $state(null);

  // Filters
  let filterProject: string = $state("");
  let filterPriority: string = $state("");
  let showDone: boolean = $state(false);

  // Selected task for detail
  let selected: TaskItem | null = $state(null);

  // New task form
  let showNewForm: boolean = $state(false);
  let newTitle: string = $state("");
  let newBody: string = $state("");
  let newProject: string = $state("");
  let newPriority: number = $state(2);
  let newTags: string = $state("");
  let newBlockedBy: string = $state("");
  let submitting: boolean = $state(false);

  const STATUS_LABELS: Record<TaskStatus, string> = {
    ready: "Ready",
    in_progress: "In Progress",
    blocked: "Blocked",
    done: "Done",
  };

  const STATUS_COLS: TaskStatus[] = ["ready", "in_progress", "blocked"];

  const grouped = $derived.by(() => {
    const map = new Map<TaskStatus, TaskItem[]>();
    for (const s of STATUS_COLS) map.set(s, []);
    if (showDone) map.set("done", []);

    for (const t of tasks) {
      const col = t.effective_status;
      if (map.has(col)) map.get(col)!.push(t);
    }
    return map;
  });

  async function load() {
    try {
      const [t, p] = await Promise.all([
        api.tasks({
          project: filterProject || undefined,
          priority: filterPriority ? parseInt(filterPriority) : undefined,
          include_done: showDone,
        }),
        api.projects(),
      ]);
      tasks = t;
      projects = p;
      error = null;
    } catch (e: any) {
      error = e.message;
    }
  }

  async function changeStatus(task: TaskItem, newStatus: TaskStatus) {
    try {
      const updated = await api.updateTask(task.id, newStatus);
      tasks = tasks.map(t => t.id === updated.id ? updated : t);
      if (selected?.id === updated.id) selected = updated;
    } catch (e: any) {
      error = e.message;
    }
  }

  async function submitNewTask() {
    if (!newTitle.trim()) return;
    submitting = true;
    try {
      const params: CreateTaskParams = {
        title: newTitle.trim(),
        body: newBody.trim(),
        project: newProject || undefined,
        priority: newPriority,
        tags: newTags ? newTags.split(",").map(t => t.trim()).filter(Boolean) : [],
        blocked_by: newBlockedBy ? newBlockedBy.split(",").map(t => t.trim()).filter(Boolean) : [],
      };
      await api.createTask(params);
      newTitle = "";
      newBody = "";
      newProject = "";
      newPriority = 2;
      newTags = "";
      newBlockedBy = "";
      showNewForm = false;
      await load();
    } catch (e: any) {
      error = e.message;
    } finally {
      submitting = false;
    }
  }

  $effect(() => {
    const stop = poll(load, POLL.NORMAL);
    return stop;
  });

  // Re-load when filters change
  $effect(() => {
    filterProject;
    filterPriority;
    showDone;
    load();
  });
</script>

<div class="page">
  <!-- Toolbar -->
  <div class="toolbar">
    <h1 class="page-title">Tasks</h1>
    <div class="filters">
      <select class="filter-select" bind:value={filterProject}>
        <option value="">All projects</option>
        {#each projects as p}
          <option value={p}>{p}</option>
        {/each}
      </select>
      <select class="filter-select" bind:value={filterPriority}>
        <option value="">All priorities</option>
        <option value="1">P1 — Urgent</option>
        <option value="2">P2 — Normal</option>
        <option value="3">P3 — Low</option>
      </select>
      <label class="toggle-label">
        <input type="checkbox" bind:checked={showDone} />
        Show done
      </label>
    </div>
    <button class="btn-new" onclick={() => (showNewForm = !showNewForm)}>
      {showNewForm ? "Cancel" : "+ New Task"}
    </button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <!-- New task form -->
  {#if showNewForm}
    <form class="new-form" onsubmit={(e) => { e.preventDefault(); submitNewTask(); }}>
      <div class="form-row">
        <input
          class="form-input form-title"
          placeholder="Task title (required)"
          bind:value={newTitle}
          required
        />
        <select class="form-select" bind:value={newProject}>
          <option value="">No project</option>
          {#each projects as p}
            <option value={p}>{p}</option>
          {/each}
        </select>
        <select class="form-select form-priority" bind:value={newPriority}>
          <option value={1}>P1</option>
          <option value={2}>P2</option>
          <option value={3}>P3</option>
        </select>
      </div>
      <textarea
        class="form-textarea"
        placeholder="Description / acceptance criteria..."
        bind:value={newBody}
        rows="3"
      ></textarea>
      <div class="form-row form-row-meta">
        <input class="form-input" placeholder="Tags (comma-separated)" bind:value={newTags} />
        <input class="form-input" placeholder="Blocked by (atom IDs, comma-separated)" bind:value={newBlockedBy} />
      </div>
      <div class="form-actions">
        <button class="btn-submit" type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create Task"}
        </button>
      </div>
    </form>
  {/if}

  <!-- Kanban columns -->
  <div class="kanban" class:four-col={showDone}>
    {#each [...grouped.entries()] as [status, colTasks]}
      <div class="kanban-col">
        <div class="col-header">
          <span class="col-title">{STATUS_LABELS[status]}</span>
          <span class="col-count">{colTasks.length}</span>
        </div>
        <div class="col-body">
          {#each colTasks as task (task.id)}
            <div
              class="task-card"
              class:selected={selected?.id === task.id}
              role="button"
              tabindex="0"
              onclick={() => selected = selected?.id === task.id ? null : task}
              onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (selected = selected?.id === task.id ? null : task)}
            >
              <div class="card-top">
                <span class="priority-badge priority-{task.priority}">P{task.priority}</span>
                {#if task.project}
                  <span class="card-project">{task.project}</span>
                {/if}
              </div>
              <p class="card-title">{task.title}</p>
              {#if task.summary}
                <p class="card-summary">{task.summary}</p>
              {/if}
              {#if task.tags.length > 0}
                <div class="card-tags">
                  {#each task.tags.slice(0, 3) as tag}
                    <span class="tag">{tag}</span>
                  {/each}
                </div>
              {/if}

              <!-- Expanded detail -->
              {#if selected?.id === task.id}
                <div class="card-detail">
                  {#if task.blocked_by.length > 0}
                    <p class="detail-row"><strong>Blocked by:</strong> {task.blocked_by.join(", ")}</p>
                  {/if}
                  {#if task.blocks.length > 0}
                    <p class="detail-row"><strong>Blocks:</strong> {task.blocks.join(", ")}</p>
                  {/if}
                  {#if task.discovered_from}
                    <p class="detail-row"><strong>Discovered from:</strong> {task.discovered_from}</p>
                  {/if}
                  <p class="detail-row detail-meta">Created: {new Date(task.created_at).toLocaleDateString()}</p>
                  <div class="status-actions">
                    {#each (["ready", "in_progress", "blocked", "done"] as TaskStatus[]) as s}
                      <button
                        type="button"
                        class="status-btn"
                        class:active={task.status === s}
                        onclick={(e) => { e.stopPropagation(); changeStatus(task, s); }}
                        disabled={task.status === s}
                      >{STATUS_LABELS[s]}</button>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/each}
          {#if colTasks.length === 0}
            <p class="col-empty">No tasks</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .page {
    height: calc(100vh - 56px);
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .page-title {
    font-size: 18px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .filters {
    display: flex;
    gap: 8px;
    align-items: center;
    flex: 1;
  }

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

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .btn-new {
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

  .btn-new:hover { opacity: 0.85; }

  /* New task form */
  .new-form {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
  }

  .form-row {
    display: flex;
    gap: 8px;
  }

  .form-row-meta { flex-wrap: wrap; }

  .form-input {
    flex: 1;
    background: var(--bg-base);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
  }

  .form-title { min-width: 200px; }

  .form-select {
    background: var(--bg-base);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
  }

  .form-priority { width: 70px; }

  .form-textarea {
    background: var(--bg-base);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    resize: vertical;
  }

  .form-actions { display: flex; justify-content: flex-end; }

  .btn-submit {
    background: var(--accent-dim);
    color: #fff;
    border: none;
    padding: 7px 18px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Kanban */
  .kanban {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    flex: 1;
    overflow: hidden;
  }

  .kanban.four-col { grid-template-columns: repeat(4, 1fr); }

  .kanban-col {
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .col-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }

  .col-count {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-hover);
    border-radius: 10px;
    padding: 1px 7px;
  }

  .col-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .col-empty {
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    padding: 20px 0;
  }

  /* Task card */
  .task-card {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    font-family: var(--font-sans);
    color: var(--text-primary);
    transition: border-color 0.15s, box-shadow 0.15s;
    user-select: none;
  }

  .task-card:hover { border-color: var(--border); }
  .task-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

  .card-top {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .priority-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .priority-1 { background: rgba(248, 113, 113, 0.2); color: var(--error); }
  .priority-2 { background: rgba(251, 191, 36, 0.2); color: var(--warning); }
  .priority-3 { background: var(--bg-hover); color: var(--text-muted); }

  .card-project {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }

  .card-title {
    font-size: 13px;
    font-weight: 500;
    line-height: 1.4;
    margin-bottom: 4px;
  }

  .card-summary {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
    margin-bottom: 6px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag {
    font-size: 10px;
    background: var(--accent-bg);
    color: var(--accent);
    padding: 1px 6px;
    border-radius: 3px;
  }

  /* Expanded detail */
  .card-detail {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .detail-row {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .detail-meta { color: var(--text-muted); }

  .status-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .status-btn {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font-sans);
  }

  .status-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .status-btn.active { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }
  .status-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .error {
    color: var(--error);
    font-size: 13px;
    padding: 8px;
    background: rgba(248, 113, 113, 0.1);
    border-radius: var(--radius-sm);
  }
</style>
