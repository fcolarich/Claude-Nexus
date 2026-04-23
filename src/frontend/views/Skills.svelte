<script lang="ts">
  import { api, type MemoryAtom } from "../lib/api";
  import { poll, POLL } from "../lib/poll";
  import AtomEditor from "../components/AtomEditor.svelte";

  let skills: MemoryAtom[] = $state([]);
  let selected: MemoryAtom | null = $state(null);
  let error: string | null = $state(null);

  async function load() {
    try { skills = await api.skills(); error = null; } catch (e: any) { error = e.message; }
  }

  async function selectSkill(skill: MemoryAtom) {
    try {
      selected = await api.memory(skill.id);
    } catch {
      selected = skill;
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
      <h2 class="panel-title">Skills</h2>
      {#each skills as skill}
        <button
          class="list-item"
          class:active={selected?.id === skill.id}
          onclick={() => selectSkill(skill)}
        >
          <span class="item-title">{skill.title}</span>
        </button>
      {/each}
      {#if skills.length === 0 && !error}
        <p class="empty">No skills found.</p>
      {/if}
      {#if error}
        <p class="error">{error}</p>
      {/if}
    </aside>

    <div class="detail-panel">
      {#if selected}
        <h2 class="detail-title">{selected.title}</h2>
        <span class="detail-path">{selected.path}</span>
        <AtomEditor atom={selected} onDeleted={handleDeleted} onSaved={handleSaved} />
      {:else}
        <div class="placeholder"><p>Select a skill to view its definition.</p></div>
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
    width: 260px; min-width: 260px; background: var(--bg-surface);
    padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
  }
  .panel-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }
  .list-item {
    padding: 10px 12px; border: none; background: none;
    color: var(--text-secondary); font-family: var(--font-sans); font-size: 13px;
    border-radius: 4px; cursor: pointer; text-align: left; width: 100%;
  }
  .list-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .list-item.active { background: var(--accent-bg); color: var(--accent); }
  .item-title { font-weight: 500; }
  .detail-panel { flex: 1; background: var(--bg-base); padding: 24px; overflow-y: auto; }
  .detail-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .detail-path { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 16px; }
  .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); }
  .error { color: var(--error); font-size: 13px; padding: 8px; }
  .empty { color: var(--text-muted); padding: 12px; font-size: 13px; }
</style>
