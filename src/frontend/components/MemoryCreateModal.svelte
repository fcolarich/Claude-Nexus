<script lang="ts">
  import { untrack } from "svelte";
  import { api, type SessionInfo } from "../lib/api";

  let { selectedText: initialText = "", session = null, onClose, onSaved }: {
    selectedText?: string;
    session?: SessionInfo | null;
    onClose: () => void;
    onSaved: () => void;
  } = $props();

  let name = $state("");
  let type = $state("memory");
  let description = $state("");
  let body = $state(untrack(() => initialText));
  let saving = $state(false);
  let error: string | null = $state(null);

  async function submit() {
    if (!name.trim() || !body.trim()) {
      error = "Name and body are required.";
      return;
    }
    saving = true;
    error = null;
    try {
      await api.createMemory({
        name: name.trim(),
        type,
        description: description.trim(),
        body: body.trim(),
        ...(session ? { sourceSessionId: session.id, sourceSessionSlug: session.slug } : {}),
      });
      onSaved();
    } catch (e: any) {
      error = e.message;
      saving = false;
    }
  }

  function backdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="backdrop" onclick={backdropClick} role="presentation">
  <div class="modal" role="dialog" aria-modal="true" aria-label="Save as Memory">
    <div class="modal-header">
      <h2>Save as Memory</h2>
      <button class="close-btn" onclick={onClose}>✕</button>
    </div>

    <div class="form">
      <label class="field">
        <span class="label">Name <span class="required">*</span></span>
        <input bind:value={name} placeholder="Short descriptive name" class="input" />
      </label>

      <label class="field">
        <span class="label">Type</span>
        <select bind:value={type} class="input">
          <option value="memory">memory</option>
          <option value="feedback">feedback</option>
          <option value="reference">reference</option>
          <option value="project">project</option>
        </select>
      </label>

      <label class="field">
        <span class="label">Description</span>
        <input bind:value={description} placeholder="One-line summary (used for retrieval)" class="input" />
      </label>

      <label class="field">
        <span class="label">Body <span class="required">*</span></span>
        <textarea bind:value={body} class="body-input" rows="8" spellcheck="false"></textarea>
      </label>

      {#if session}
        <div class="source-info">
          <span class="source-label">Source session:</span>
          <span class="source-value">{session.slug ?? session.id.slice(0, 8)} · {session.project}</span>
        </div>
      {/if}

      {#if error}<p class="err">{error}</p>{/if}
    </div>

    <div class="modal-footer">
      <button class="btn btn-cancel" onclick={onClose} disabled={saving}>Cancel</button>
      <button class="btn btn-save" onclick={submit} disabled={saving}>
        {saving ? "Saving…" : "Save Memory"}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 560px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .modal-header h2 { font-size: 16px; font-weight: 700; margin: 0; }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .close-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  .form {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
  }

  .field { display: flex; flex-direction: column; gap: 5px; }
  .label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
  .required { color: var(--error); }

  .input {
    padding: 8px 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    outline: none;
  }
  .input:focus { border-color: var(--accent-dim); }

  .body-input {
    padding: 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    resize: vertical;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .body-input:focus { border-color: var(--accent-dim); }

  .source-info {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 10px;
    background: var(--bg-base);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
  .source-label { color: var(--text-muted); }
  .source-value { color: var(--text-secondary); font-family: var(--font-mono); }

  .modal-footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 14px 20px;
    border-top: 1px solid var(--border-subtle);
  }

  .btn {
    padding: 7px 16px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-cancel { background: none; color: var(--text-secondary); border-color: var(--border); }
  .btn-cancel:hover:not(:disabled) { background: var(--bg-hover); }

  .btn-save { background: var(--accent); color: white; border-color: var(--accent); }
  .btn-save:hover:not(:disabled) { opacity: 0.85; }

  .err { color: var(--error); font-size: 13px; margin: 0; }
</style>
