<script lang="ts">
  import "./app.css";
  import Sidebar from "./components/Sidebar.svelte";
  import Dashboard from "./views/Dashboard.svelte";
  import Sessions from "./views/Sessions.svelte";
  import Memories from "./views/Memories.svelte";
  import Search from "./views/Search.svelte";
  import Plans from "./views/Plans.svelte";
  import Agents from "./views/Agents.svelte";
  import Skills from "./views/Skills.svelte";
  import { currentRoute } from "./lib/router";
</script>

<div class="shell">
  <Sidebar />
  <main class="content">
    {#if $currentRoute === "dashboard"}
      <Dashboard />
    {:else if $currentRoute === "sessions"}
      <Sessions />
    {:else if $currentRoute === "memories"}
      <Memories />
    {:else if $currentRoute === "search"}
      <Search />
    {:else if $currentRoute === "plans"}
      <Plans />
    {:else if $currentRoute === "agents"}
      <Agents />
    {:else if $currentRoute === "skills"}
      <Skills />
    {/if}
  </main>
</div>

<style>
  .shell {
    display: flex;
    height: 100vh;
    width: 100vw;
  }
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 28px 32px;
  }
</style>
