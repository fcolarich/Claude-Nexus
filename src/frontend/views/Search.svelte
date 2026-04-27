<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { navigate } from "../lib/router";
  import { searchStore } from "../lib/searchStore";

  let query = $state($searchStore.query);
  let typeFilter = $state($searchStore.typeFilter);
  let results = $state($searchStore.results);
  let searched = $state($searchStore.searched);
  let loading = $state(false);

  async function search() {
    if (!query.trim()) return;
    loading = true;
    searched = true;
    try {
      results = await api.search(query, typeFilter || undefined);
    } catch {
      results = [];
    }
    loading = false;
    searchStore.set({ query, typeFilter, results, searched });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") search();
  }

  $effect(() => {
    searchStore.set({ query, typeFilter, results, searched });
  });

  onMount(() => {
    if (query.trim()) search();
  });
</script>

<div class="page">
  <h1 class="page-title">Search</h1>

  <div class="search-bar">
    <input
      class="search-input"
      type="text"
      placeholder="Search memories, plans, agents..."
      bind:value={query}
      onkeydown={handleKeydown}
    />
    <select class="type-select" bind:value={typeFilter}>
      <option value="">All types</option>
      <option value="memory">Memories</option>
      <option value="plan">Plans</option>
      <option value="agent">Agents</option>
      <option value="skill">Skills</option>
    </select>
    <button class="search-btn" onclick={search} disabled={loading}>
      {loading ? "..." : "Search"}
    </button>
  </div>

  {#if searched}
    <p class="result-count">{results.length} result{results.length !== 1 ? "s" : ""}</p>
    <div class="results">
      {#each results as r}
        <button class="result-card" onclick={() => navigate("memories", { id: String(r.id) })}>
          <div class="result-header">
            <span class="type-badge type-{r.type}">{r.type}</span>
            <span class="result-title">{r.title}</span>
            <span class="result-project">{r.project}</span>
          </div>
          <p class="result-snippet">{r.snippet}</p>
          <span class="result-path">{r.path}</span>
        </button>
      {/each}
      {#if results.length === 0}
        <p class="empty">No results for "{query}"</p>
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

  .search-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
  }

  .search-input {
    flex: 1;
    padding: 10px 14px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 14px;
  }

  .search-input::placeholder { color: var(--text-muted); }
  .search-input:focus { outline: none; border-color: var(--accent-dim); }

  .type-select {
    padding: 10px 12px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
  }

  .search-btn {
    padding: 10px 20px;
    background: var(--accent-dim);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .search-btn:hover { background: var(--accent); }
  .search-btn:disabled { opacity: 0.5; }

  .result-count { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; }

  .results { display: flex; flex-direction: column; gap: 8px; }

  .result-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 14px 16px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    color: var(--text-primary);
    font-family: var(--font-sans);
    transition: border-color 0.15s;
  }

  .result-card:hover { border-color: var(--border); }

  .result-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .result-title { font-weight: 600; font-size: 14px; }
  .result-project { font-size: 12px; color: var(--text-muted); margin-left: auto; }

  .type-badge {
    font-size: 10px; font-weight: 600; padding: 1px 5px;
    border-radius: 3px; text-transform: uppercase;
  }
  .type-memory { background: rgba(192, 132, 252, 0.15); color: var(--accent); }
  .type-plan { background: rgba(248, 113, 113, 0.15); color: var(--error); }
  .type-agent { background: rgba(96, 165, 250, 0.15); color: var(--info); }
  .type-skill { background: rgba(74, 222, 128, 0.15); color: var(--success); }

  .result-snippet {
    font-size: 13px; color: var(--text-secondary);
    line-height: 1.5; margin-bottom: 4px;
  }

  .result-path { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
  .empty { color: var(--text-muted); padding: 20px; text-align: center; }
</style>
