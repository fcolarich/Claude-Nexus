<script lang="ts">
  import { api, type SessionInfo, type ConversationMessage, type MessageBlock, type SessionReference } from "../lib/api";
  import { poll, POLL } from "../lib/poll";
  import MemoryCreateModal from "../components/MemoryCreateModal.svelte";

  let sessions: SessionInfo[] = $state([]);
  let filter: "all" | "active" | "waiting" | "idle" = $state("all");
  let error: string | null = $state(null);
  let editingId: string | null = $state(null);
  let editValue: string = $state("");

  let selectedSession: SessionInfo | null = $state(null);
  let messages: ConversationMessage[] = $state([]);
  let loadingMessages = $state(false);
  let messagesError: string | null = $state(null);

  // Delete state
  let deletingSession: SessionInfo | null = $state(null);
  let deleteReferences: SessionReference[] = $state([]);
  let deleteConfirming = $state(false);
  let deleteInProgress = $state(false);
  let deleteError: string | null = $state(null);

  // Memory creation from selection
  let selectedText = $state("");
  let showCreateModal = $state(false);
  let conversationPanel: HTMLElement | null = $state(null);

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
    try { sessions = await api.sessions(); error = null; }
    catch (e: any) { error = e.message; }
  }

  async function selectSession(session: SessionInfo) {
    selectedSession = session;
    messages = [];
    messagesError = null;
    loadingMessages = true;
    cancelDelete();
    try {
      const result = await api.sessionMessages(session.id);
      messages = result.messages;
    } catch (e: any) {
      messagesError = e.message;
    } finally {
      loadingMessages = false;
    }
  }

  function startRename(session: SessionInfo, e: MouseEvent) {
    e.stopPropagation();
    editingId = session.id;
    editValue = session.title;
  }

  async function saveRename(id: string) {
    if (editValue.trim()) {
      try { await api.renameSession(id, editValue.trim()); await load(); } catch {}
    }
    editingId = null;
  }

  // --- Delete flow ---
  async function startDelete(session: SessionInfo, e: MouseEvent) {
    e.stopPropagation();
    deletingSession = session;
    deleteError = null;
    deleteConfirming = false;
    try {
      const result = await api.sessionReferences(session.id);
      deleteReferences = result.references;
      deleteConfirming = true;
    } catch (e: any) {
      deleteError = e.message;
    }
  }

  function cancelDelete() {
    deletingSession = null;
    deleteReferences = [];
    deleteConfirming = false;
    deleteInProgress = false;
    deleteError = null;
  }

  async function confirmDelete() {
    if (!deletingSession) return;
    deleteInProgress = true;
    deleteError = null;
    try {
      await api.deleteSession(deletingSession.id);
      if (selectedSession?.id === deletingSession.id) {
        selectedSession = null;
        messages = [];
      }
      cancelDelete();
      await load();
    } catch (e: any) {
      deleteError = e.message;
      deleteInProgress = false;
    }
  }

  // --- Text selection for memory creation ---
  function onSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !conversationPanel) { selectedText = ""; return; }
    const range = sel.getRangeAt(0);
    if (conversationPanel.contains(range.commonAncestorContainer))
      selectedText = sel.toString().trim();
    else selectedText = "";
  }

  function openCreateModal() {
    const sel = window.getSelection();
    if (sel) selectedText = sel.toString().trim();
    showCreateModal = true;
  }

  function formatTime(ts: string): string {
    if (!ts) return "";
    try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  }

  function toolSummary(input: Record<string, unknown>): string {
    const entries = Object.entries(input);
    if (entries.length === 0) return "";
    const [key, val] = entries[0];
    const v = typeof val === "string" ? val : JSON.stringify(val);
    return `${key}="${v.length > 60 ? v.slice(0, 60) + "…" : v}"`;
  }

  $effect(() => {
    const stop = poll(load, POLL.FAST);
    return stop;
  });

  $effect(() => {
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  });
</script>

<div class="page">
  <div class="split-layout">

    <!-- Left: session list -->
    <aside class="list-panel">
      <h2 class="panel-title">Sessions</h2>

      <div class="filters">
        {#each ["all", "active", "waiting", "idle"] as f}
          <button class="filter-chip" class:active={filter === f} onclick={() => (filter = f as any)}>
            {f} <span class="chip-count">{counts[f as keyof typeof counts]}</span>
          </button>
        {/each}
      </div>

      {#if error}
        <p class="list-error">API unavailable: {error}</p>
      {:else}
        <div class="session-list">
          {#each filtered as session}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <div
              class="session-row"
              class:selected={selectedSession?.id === session.id}
              onclick={() => selectSession(session)}
              onkeydown={(e) => e.key === "Enter" && selectSession(session)}
              tabindex="0"
              role="option"
              aria-selected={selectedSession?.id === session.id}
            >
              <span class="status-dot status-{session.status}"></span>
              <div class="session-info">
                {#if editingId === session.id}
                  <input
                    class="rename-input"
                    bind:value={editValue}
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => { if (e.key === "Enter") saveRename(session.id); if (e.key === "Escape") editingId = null; }}
                    onblur={() => saveRename(session.id)}
                  />
                {:else}
                  <span class="session-title" ondblclick={(e) => startRename(session, e)} title="Double-click to rename">
                    {session.title}
                  </span>
                {/if}
                <span class="session-meta">
                  <span class="session-project">{session.project}</span>
                  <span class="sep">·</span>
                  <span class="session-msgs">{session.messageCount} msgs</span>
                </span>
              </div>
              <button
                class="delete-row-btn"
                title="Delete session"
                onclick={(e) => startDelete(session, e)}
              >✕</button>
              {#if session.pendingPrompt}
                <span class="waiting-badge">Waiting</span>
              {/if}
            </div>
          {/each}
          {#if filtered.length === 0}
            <p class="empty">No {filter === "all" ? "" : filter} sessions.</p>
          {/if}
        </div>
      {/if}
    </aside>

    <!-- Right: conversation viewer -->
    <div class="conversation-panel">
      {#if deleteConfirming && deletingSession}
        <!-- Delete confirmation overlay -->
        <div class="delete-overlay">
          <div class="delete-box">
            <h3>Delete session?</h3>
            <p class="delete-desc">
              This will permanently remove the JSONL file and session record for<br/>
              <strong>{deletingSession.title}</strong>
            </p>

            {#if deleteReferences.length > 0}
              <div class="ref-warning">
                <span class="warn-icon">⚠️</span>
                <div>
                  <strong>{deleteReferences.length} memory atom{deleteReferences.length > 1 ? "s" : ""} reference this session</strong>
                  — deleting will lose that context link.
                  <ul class="ref-list">
                    {#each deleteReferences as ref}
                      <li>{ref.title}</li>
                    {/each}
                  </ul>
                </div>
              </div>
            {/if}

            {#if deleteError}<p class="err">{deleteError}</p>{/if}

            <div class="delete-actions">
              <button class="btn btn-confirm-delete" onclick={confirmDelete} disabled={deleteInProgress}>
                {deleteInProgress ? "Deleting…" : "Yes, delete permanently"}
              </button>
              <button class="btn btn-cancel" onclick={cancelDelete} disabled={deleteInProgress}>Cancel</button>
            </div>
          </div>
        </div>

      {:else if !selectedSession}
        <div class="placeholder"><p>Select a session to view the conversation.</p></div>

      {:else if loadingMessages}
        <div class="placeholder"><p>Loading messages…</p></div>

      {:else if messagesError}
        <div class="placeholder"><p class="err">Failed to load: {messagesError}</p></div>

      {:else}
        <div class="conv-header">
          <div class="conv-title-row">
            <div>
              <div class="conv-title">{selectedSession.title}</div>
              <div class="conv-meta">{selectedSession.project} · {selectedSession.id.slice(0, 8)}</div>
            </div>
            <button class="btn btn-delete-session" onclick={(e) => startDelete(selectedSession!, e)}>
              Delete session
            </button>
          </div>
        </div>

        <div class="messages" bind:this={conversationPanel}>
          {#each messages as msg}
            <div class="message message-{msg.role}">
              <div class="msg-meta">
                <span class="msg-role">{msg.role === "user" ? "You" : "Claude"}</span>
                <span class="msg-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div class="msg-body">
                {#each msg.blocks as block}
                  {@const b = block as any}
                  {#if b.type === "text"}
                    <div class="block-text">{b.text}</div>
                  {:else if b.type === "image"}
                    <img class="block-image" src="data:{b.mediaType};base64,{b.data}" alt="Attachment" />
                  {:else if b.type === "thinking"}
                    <div class="block-thinking">
                      <span class="block-label">💭 Thinking</span>
                      <pre class="block-pre">{b.text}</pre>
                    </div>
                  {:else if b.type === "tool_use"}
                    <div class="block-tool-use">
                      <span class="block-label">🔧 {b.toolName}({toolSummary(b.toolInput)})</span>
                    </div>
                  {:else if b.type === "tool_result"}
                    <div class="block-tool-result" class:is-error={b.isError}>
                      <span class="block-label">{b.isError ? "❌ Error" : "↩ Result"}</span>
                      {#if b.resultContent}
                        <pre class="block-pre">{b.resultContent.slice(0, 500)}{b.resultContent.length > 500 ? "\n…" : ""}</pre>
                      {/if}
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
          {#if messages.length === 0}
            <p class="empty-conv">No readable messages in this session.</p>
          {/if}
        </div>

        {#if selectedText}
          <div class="save-bar">
            <span class="save-hint">Text selected</span>
            <button class="btn-save-memory" onclick={openCreateModal}>Save as Memory</button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

{#if showCreateModal && selectedSession}
  <MemoryCreateModal
    selectedText={selectedText}
    session={selectedSession}
    onClose={() => (showCreateModal = false)}
    onSaved={() => { showCreateModal = false; selectedText = ""; }}
  />
{/if}

<style>
  .page { height: calc(100vh - 56px); }

  .split-layout {
    display: flex; height: 100%; gap: 1px;
    background: var(--border-subtle); border-radius: var(--radius-md); overflow: hidden;
  }

  /* ---- Left panel ---- */
  .list-panel {
    width: 340px; min-width: 340px;
    background: var(--bg-surface); padding: 16px;
    overflow-y: auto; display: flex; flex-direction: column; gap: 12px;
  }

  .panel-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); }

  .filters { display: flex; flex-wrap: wrap; gap: 6px; }

  .filter-chip {
    padding: 4px 10px; border: 1px solid var(--border); border-radius: 14px;
    background: none; color: var(--text-secondary);
    font-family: var(--font-sans); font-size: 12px; font-weight: 500;
    cursor: pointer; text-transform: capitalize; transition: all 0.15s;
  }
  .filter-chip:hover { border-color: var(--text-muted); }
  .filter-chip.active { background: var(--accent-bg); border-color: var(--accent-dim); color: var(--accent); }
  .chip-count { opacity: 0.7; margin-left: 3px; }

  .session-list { display: flex; flex-direction: column; gap: 4px; }

  .session-row {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: var(--radius-sm);
    cursor: pointer; border: 1px solid transparent;
    transition: background 0.12s; position: relative;
    outline: none;
  }
  .session-row:focus-visible { border-color: var(--accent-dim); }
  .session-row:hover { background: var(--bg-hover); }
  .session-row:hover .delete-row-btn { opacity: 1; }
  .session-row.selected { background: var(--accent-bg); border-color: var(--accent-dim); }

  .delete-row-btn {
    opacity: 0; background: none; border: none; color: var(--text-muted);
    font-size: 12px; cursor: pointer; padding: 2px 6px; border-radius: 3px;
    margin-left: auto; flex-shrink: 0; transition: opacity 0.1s, color 0.1s;
    font-family: var(--font-sans);
  }
  .delete-row-btn:hover { color: var(--error); }

  .status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .status-active { background: var(--success); }
  .status-idle { background: var(--text-muted); }
  .status-waiting { background: var(--warning); animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .session-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .session-title {
    font-weight: 600; font-size: 13px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default;
  }
  .session-meta { display: flex; gap: 4px; align-items: center; font-size: 11px; color: var(--text-muted); }
  .session-project { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
  .sep { color: var(--text-muted); }
  .rename-input {
    font-weight: 600; font-size: 13px; background: var(--bg-elevated);
    border: 1px solid var(--accent-dim); border-radius: 4px; padding: 2px 6px;
    color: var(--text-primary); font-family: var(--font-sans); outline: none; width: 100%;
  }
  .waiting-badge {
    padding: 2px 7px; font-size: 10px; font-weight: 600;
    background: rgba(251, 191, 36, 0.12); color: var(--warning); border-radius: 4px; flex-shrink: 0;
  }

  /* ---- Right panel ---- */
  .conversation-panel {
    flex: 1; background: var(--bg-base);
    display: flex; flex-direction: column; overflow: hidden; position: relative;
  }

  .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); }

  /* Delete overlay */
  .delete-overlay {
    display: flex; align-items: center; justify-content: center; height: 100%;
    padding: 24px;
  }
  .delete-box {
    background: var(--bg-surface); border: 1px solid var(--error);
    border-radius: var(--radius-md); padding: 24px; max-width: 480px; width: 100%;
    display: flex; flex-direction: column; gap: 16px;
  }
  .delete-box h3 { margin: 0; font-size: 16px; }
  .delete-desc { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
  .ref-warning {
    display: flex; gap: 12px; align-items: flex-start;
    padding: 12px; background: rgba(251, 191, 36, 0.08);
    border: 1px solid var(--warning); border-radius: var(--radius-sm);
    font-size: 13px;
  }
  .warn-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
  .ref-list { margin: 6px 0 0; padding-left: 16px; font-size: 12px; color: var(--text-muted); }
  .ref-list li { margin-bottom: 2px; }
  .delete-actions { display: flex; gap: 8px; }

  /* Conv header */
  .conv-header {
    padding: 14px 20px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
  }
  .conv-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .conv-title { font-size: 15px; font-weight: 700; }
  .conv-meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

  /* Messages */
  .messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }

  .message { display: flex; flex-direction: column; gap: 4px; }

  .msg-meta { display: flex; align-items: center; gap: 8px; }
  .msg-role { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .message-user .msg-role { color: var(--accent); }
  .message-assistant .msg-role { color: var(--text-secondary); }
  .msg-time { font-size: 11px; color: var(--text-muted); }

  .msg-body { display: flex; flex-direction: column; gap: 6px; }

  .block-text {
    font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word;
    padding: 10px 14px; border-radius: var(--radius-sm);
  }
  .message-user .block-text { background: var(--accent-bg); border-left: 2px solid var(--accent-dim); }
  .message-assistant .block-text { background: var(--bg-surface); }

  .block-image {
    max-width: 100%; max-height: 480px; border-radius: var(--radius-sm);
    object-fit: contain; border: 1px solid var(--border-subtle);
  }

  .block-thinking,
  .block-tool-use,
  .block-tool-result {
    border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);
    font-size: 12px; overflow: hidden;
    background: var(--bg-surface);
  }
  .block-thinking { border-color: var(--accent-dim); }
  .block-tool-result.is-error { border-color: var(--error); }

  .block-label {
    display: block; padding: 6px 12px;
    font-weight: 500; color: var(--text-muted); font-size: 12px;
    background: var(--bg-surface);
  }
  .block-thinking .block-label { color: var(--accent); }
  .block-tool-result.is-error .block-label { color: var(--error); }

  .block-pre {
    margin: 0; padding: 10px 12px;
    background: var(--bg-base); font-size: 12px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word; overflow-x: auto;
    border-top: 1px solid var(--border-subtle);
  }

  /* Save bar */
  .save-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 20px; border-top: 1px solid var(--border-subtle);
    background: var(--bg-surface); flex-shrink: 0;
  }
  .save-hint { font-size: 12px; color: var(--text-muted); }
  .btn-save-memory {
    padding: 6px 16px; background: var(--accent); color: white;
    border: none; border-radius: var(--radius-sm);
    font-family: var(--font-sans); font-size: 13px; font-weight: 500;
    cursor: pointer; transition: opacity 0.15s;
  }
  .btn-save-memory:hover { opacity: 0.85; }

  /* Shared buttons */
  .btn {
    padding: 7px 14px; border-radius: var(--radius-sm);
    font-family: var(--font-sans); font-size: 13px; font-weight: 500;
    cursor: pointer; border: 1px solid transparent; transition: all 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-cancel { background: none; color: var(--text-secondary); border-color: var(--border); }
  .btn-cancel:hover:not(:disabled) { background: var(--bg-hover); }
  .btn-confirm-delete { background: var(--error); color: white; border-color: var(--error); }
  .btn-confirm-delete:hover:not(:disabled) { opacity: 0.85; }
  .btn-delete-session {
    padding: 5px 12px; background: none; color: var(--text-muted);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    font-family: var(--font-sans); font-size: 12px; cursor: pointer; transition: all 0.15s;
  }
  .btn-delete-session:hover { color: var(--error); border-color: var(--error); }

  .empty-conv { color: var(--text-muted); text-align: center; padding: 40px 0; }
  .list-error { color: var(--error); font-size: 13px; }
  .empty { color: var(--text-muted); padding: 12px; font-size: 13px; }
  .err { color: var(--error); }
</style>
