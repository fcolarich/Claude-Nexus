<script lang="ts">
  import { currentRoute, navigate, type Route } from "../lib/router";

  const navItems: { route: Route; label: string; icon: string }[] = [
    { route: "dashboard", label: "Dashboard", icon: "⌂" },
    { route: "tasks", label: "Tasks", icon: "✓" },
    { route: "sessions", label: "Sessions", icon: "◉" },
    { route: "memories", label: "Memories", icon: "◈" },
    { route: "plans", label: "Plans", icon: "▤" },
    { route: "agents", label: "Agents", icon: "◎" },
    { route: "skills", label: "Skills", icon: "⚡" },
    { route: "search", label: "Search", icon: "⌕" },
  ];
</script>

<nav class="sidebar">
  <div class="logo">
    <span class="logo-mark">◆</span>
    <span class="logo-text">Claude Nexus</span>
  </div>

  <div class="nav-group">
    {#each navItems as item}
      <button
        class="nav-item"
        class:active={$currentRoute === item.route}
        onclick={() => navigate(item.route)}
      >
        <span class="nav-icon">{item.icon}</span>
        <span class="nav-label">{item.label}</span>
      </button>
    {/each}
  </div>

  <div class="sidebar-footer">
    <span class="version">v0.1.0</span>
  </div>
</nav>

<style>
  .sidebar {
    width: var(--sidebar-width);
    min-width: var(--sidebar-width);
    height: 100vh;
    background: var(--bg-surface);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 8px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px 20px;
  }

  .logo-mark {
    color: var(--accent);
    font-size: 20px;
  }

  .logo-text {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .nav-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 13.5px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s ease;
    width: 100%;
    text-align: left;
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--accent-bg);
    color: var(--accent);
  }

  .nav-icon {
    font-size: 15px;
    width: 20px;
    text-align: center;
  }

  .sidebar-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--border-subtle);
  }

  .version {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
</style>
