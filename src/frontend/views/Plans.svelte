<script lang="ts">
  import { api, type MemoryAtom } from "../lib/api";
  import { poll, POLL } from "../lib/poll";
  import AtomEditor from "../components/AtomEditor.svelte";

  let plans: MemoryAtom[] = $state([]);
  let selected: MemoryAtom | null = $state(null);
  let error: string | null = $state(null);

  async function load() {
    try { plans = await api.plans(); error = null; } catch (e: any) { error = e.message; }
  }

  async function selectPlan(plan: MemoryAtom) {
    try {
      selected = await api.memory(plan.id);
    } catch {
      selected = plan;
    }
  }

  function handleDeleted() {
    selected = null;
    load();
  }

  function handleSaved(updated: MemoryAtom) {
    selected = updated;
    load();
  }

  $effect(() => {
    const stop = poll(load, POLL.SLOW);
    return stop;
  });
</script>

<div class="page">
  <div class="split-layout">
    <aside class="list-panel">
      <h2 class="panel-title">Plans</h2>
      {#each plans as plan}
        <button
          class="list-item"
          class:active={selected?.id === plan.id}
          onclick={() => selectPlan(plan)}
        >
          <span class="item-title">{plan.title}</span>
          <span class="item-meta">{plan.project}</span>
        </button>
      {/each}
      {#if plans.length === 0 && !error}
        <p class="empty">No plans indexed.</p>
      {/if}
      {#if error}
        <p class="error">{error}</p>
      {/if}
    </aside>

    <div class="detail-panel">
      {#if selected}
        <h2 class="detail-title">{selected.title}</h2>
        <div class="detail-meta">
          <span>{selected.project}</span>
          <span class="detail-path">{selected.path}</span>
        </div>
        <AtomEditor atom={selected} onDeleted={handleDeleted} onSaved={handleSaved} />
      {:else}
        <div class="placeholder"><p>Select a plan to view.</p></div>
      {/if}
    </div>
  </div>
</div>

<style>
  .page { height: calc(100vh - 56px); }

  .split-layout {
    display: flex; height: 100%; gap: 1px;
    background: var(--border-subtle); border-radius: var(--radius-md); overflow: hidden;
  }

  .list-panel {
    width: 280px; min-width: 280px;
    background: var(--bg-surface); padding: 16px;
    overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
  }

  .panel-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }

  .list-item {
    display: flex; flex-direction: column; gap: 2px;
    padding: 10px 12px; border: none; background: none;
    color: var(--text-secondary); font-family: var(--font-sans); font-size: 13px;
    border-radius: 4px; cursor: pointer; text-align: left; width: 100%;
  }
  .list-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .list-item.active { background: var(--accent-bg); color: var(--accent); }

  .item-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-meta { font-size: 11px; color: var(--text-muted); }

  .detail-panel { flex: 1; background: var(--bg-base); padding: 24px; overflow-y: auto; }
  .detail-title { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
  .detail-meta { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; display: flex; gap: 12px; }
  .detail-path { font-family: var(--font-mono); font-size: 11px; }

  .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); }
  .error { color: var(--error); font-size: 13px; padding: 8px; }
  .empty { color: var(--text-muted); padding: 12px; font-size: 13px; }
</style>
