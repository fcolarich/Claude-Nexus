<script lang="ts">
  import { api, type MemoryAtom } from "../lib/api";
  import { routeParams, navigate } from "../lib/router";
  import { poll, POLL } from "../lib/poll";
  import AtomEditor from "../components/AtomEditor.svelte";

  let memories: MemoryAtom[] = $state([]);
  let projects: string[] = $state([]);
  let selectedProject: string = $state("");
  let selectedMemory: MemoryAtom | null = $state(null);
  let error: string | null = $state(null);

  const grouped = $derived.by(() => {
    const map = new Map<string, MemoryAtom[]>();
    for (const m of memories) {
      const key = m.project;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  });

  async function load() {
    try {
      const [mems, projs] = await Promise.all([
        api.memories(selectedProject || undefined),
        api.projects(),
      ]);
      memories = mems;
      projects = projs;
    } catch (e: any) {
      error = e.message;
    }
  }

  async function selectMemory(m: MemoryAtom) {
    try {
      selectedMemory = await api.memory(m.id);
    } catch {
      selectedMemory = m;
    }
  }

  function handleDeleted() {
    selectedMemory = null;
    load();
  }

  function handleSaved(updated: MemoryAtom) {
    selectedMemory = updated;
    load();
  }

  poll(load, POLL.NORMAL);

  $effect(() => {
    const p = $routeParams;
    if (p.project) selectedProject = p.project;
    load().then(() => {
      if (p.id) {
        const target = memories.find((m) => String(m.id) === p.id);
        if (target) selectMemory(target);
      }
    });
  });
</script>

<div class="page">
  <div class="memory-layout">
    <aside class="tree-panel">
      <h2 class="panel-title">Memory Browser</h2>
      <select class="project-select" bind:value={selectedProject} onchange={() => load()}>
        <option value="">All projects</option>
        {#each projects as p}
          <option value={p}>{p}</option>
        {/each}
      </select>

      <div class="tree">
        {#each [...grouped.entries()] as [project, atoms]}
          <div class="tree-group">
            <span class="tree-project">{project}</span>
            {#each atoms as atom}
              <button
                class="tree-item"
                class:active={selectedMemory?.id === atom.id}
                onclick={() => selectMemory(atom)}
              >
                <span class="type-badge type-{atom.type}">{atom.type.slice(0, 3)}</span>
                <span class="tree-label">{atom.title}</span>
              </button>
            {/each}
          </div>
        {/each}
        {#if memories.length === 0 && !error}
          <p class="empty">No memories indexed yet.</p>
        {/if}
      </div>
    </aside>

    <div class="detail-panel">
      {#if error}
        <p class="error">API unavailable: {error}</p>
      {:else if selectedMemory}
        <div class="detail-header">
          <h2 class="detail-title">{selectedMemory.title}</h2>
          <div class="detail-meta">
            <span class="type-badge type-{selectedMemory.type}">{selectedMemory.type}</span>
            <span class="detail-project">{selectedMemory.project}</span>
            <span class="detail-path">{selectedMemory.path}</span>
          </div>
        </div>
        {#if selectedMemory.links.length > 0}
          <div class="links-panel">
            <h3 class="links-title">Links</h3>
            <div class="links-list">
              {#each selectedMemory.links as link}
                <button class="link-chip" onclick={() => navigate("memories", { id: String(link.id) })}>
                  <span class="link-type">{link.type}</span>
                  {link.title}
                </button>
              {/each}
            </div>
          </div>
        {/if}
        <AtomEditor atom={selectedMemory} onDeleted={handleDeleted} onSaved={handleSaved} />
      {:else}
        <div class="placeholder">
          <p>Select a memory from the sidebar to view its contents.</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .page { height: calc(100vh - 56px); }

  .memory-layout {
    display: flex;
    height: 100%;
    gap: 1px;
    background: var(--border-subtle);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .tree-panel {
    width: 280px;
    min-width: 280px;
    background: var(--bg-surface);
    padding: 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .project-select {
    width: 100%;
    padding: 7px 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
  }

  .tree { display: flex; flex-direction: column; gap: 12px; }

  .tree-group { display: flex; flex-direction: column; gap: 2px; }

  .tree-project {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 8px;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .tree-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .tree-item.active { background: var(--accent-bg); color: var(--accent); }

  .type-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .type-project { background: rgba(96, 165, 250, 0.15); color: var(--info); }
  .type-feedback { background: rgba(251, 191, 36, 0.15); color: var(--warning); }
  .type-reference { background: rgba(74, 222, 128, 0.15); color: var(--success); }
  .type-memory { background: rgba(192, 132, 252, 0.15); color: var(--accent); }
  .type-plan { background: rgba(248, 113, 113, 0.15); color: var(--error); }
  .type-agent { background: rgba(96, 165, 250, 0.15); color: var(--info); }
  .type-skill { background: rgba(74, 222, 128, 0.15); color: var(--success); }

  .tree-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .detail-panel {
    flex: 1;
    background: var(--bg-base);
    padding: 24px;
    overflow-y: auto;
  }

  .detail-header { margin-bottom: 16px; }
  .detail-title { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
  .detail-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-muted); }
  .detail-project { font-weight: 500; }
  .detail-path { font-family: var(--font-mono); font-size: 11px; }

  .links-panel {
    margin-bottom: 16px;
    padding: 12px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
  }

  .links-title { font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
  .links-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .link-chip {
    padding: 3px 10px;
    font-size: 12px;
    background: var(--accent-bg);
    color: var(--accent);
    border-radius: 12px;
    border: none;
    cursor: pointer;
    font-family: var(--font-sans);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: background 0.15s;
  }
  .link-chip:hover { background: var(--accent-dim); color: white; }
  .link-type {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0.7;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
  }

  .error { color: var(--error); padding: 20px; }
  .empty { color: var(--text-muted); padding: 12px 8px; font-size: 13px; }
</style>
