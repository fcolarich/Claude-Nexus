<script lang="ts">
  import { untrack } from "svelte";
  import { api, type MemoryAtom } from "../lib/api";

  let { atom, onDeleted, onSaved }: {
    atom: MemoryAtom;
    onDeleted: () => void;
    onSaved: (updated: MemoryAtom) => void;
  } = $props();

  let mode: "view" | "editing" | "confirming" = $state("view");
  let rawContent: string = $state(untrack(() => atom.body));
  let editBody: string = $state("");
  let saving = $state(false);
  let deleting = $state(false);
  let error: string | null = $state(null);
  let textareaEl: HTMLTextAreaElement | null = $state(null);

  $effect(() => {
    const id = atom.id;
    api.atomRaw(id).then(r => { rawContent = r.rawContent; }).catch(() => {});
  });

  function startEdit() {
    editBody = rawContent;
    mode = "editing";
    setTimeout(() => textareaEl?.focus(), 0);
  }

  function cancelEdit() {
    mode = "view";
    error = null;
  }

  async function save() {
    saving = true;
    error = null;
    try {
      const updated = await api.updateAtom(atom.id, editBody);
      mode = "view";
      onSaved(updated);
    } catch (e: any) {
      error = e.message;
    } finally {
      saving = false;
    }
  }

  async function confirmDelete() {
    deleting = true;
    error = null;
    try {
      await api.deleteAtom(atom.id);
      onDeleted();
    } catch (e: any) {
      error = e.message;
      deleting = false;
    }
  }
</script>

<div class="atom-editor">
  {#if mode === "view"}
    <div class="toolbar">
      <button class="btn btn-edit" onclick={startEdit}>Edit</button>
      <button class="btn btn-delete" onclick={() => (mode = "confirming")}>Delete</button>
    </div>
    <pre class="body-view">{rawContent}</pre>

  {:else if mode === "editing"}
    <div class="toolbar">
      <button class="btn btn-save" onclick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button class="btn btn-cancel" onclick={cancelEdit} disabled={saving}>Cancel</button>
    </div>
    {#if error}<p class="err">{error}</p>{/if}
    <textarea
      bind:this={textareaEl}
      bind:value={editBody}
      class="body-editor"
      spellcheck="false"
    ></textarea>

  {:else if mode === "confirming"}
    <div class="confirm-box">
      <p>Delete this file from disk? This cannot be undone.</p>
      <div class="confirm-actions">
        <button class="btn btn-confirm-delete" onclick={confirmDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Yes, delete"}
        </button>
        <button class="btn btn-cancel" onclick={() => { mode = "view"; error = null; }} disabled={deleting}>
          Cancel
        </button>
      </div>
      {#if error}<p class="err">{error}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .atom-editor { display: flex; flex-direction: column; gap: 12px; }

  .toolbar { display: flex; gap: 8px; }

  .btn {
    padding: 5px 14px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-edit { background: var(--accent-bg); color: var(--accent); border-color: var(--accent-dim); }
  .btn-edit:hover { background: var(--accent-dim); color: white; }

  .btn-delete { background: none; color: var(--text-muted); border-color: var(--border); }
  .btn-delete:hover { color: var(--error); border-color: var(--error); }

  .btn-save { background: var(--accent); color: white; border-color: var(--accent); }
  .btn-save:hover:not(:disabled) { opacity: 0.85; }

  .btn-cancel { background: none; color: var(--text-secondary); border-color: var(--border); }
  .btn-cancel:hover:not(:disabled) { background: var(--bg-hover); }

  .btn-confirm-delete { background: var(--error); color: white; border-color: var(--error); }
  .btn-confirm-delete:hover:not(:disabled) { opacity: 0.85; }

  .body-view {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
    line-height: 1.7;
    margin: 0;
  }

  .body-editor {
    width: 100%;
    min-height: 400px;
    padding: 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--accent-dim);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.7;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }

  .confirm-box {
    padding: 16px;
    background: rgba(248, 113, 113, 0.08);
    border: 1px solid var(--error);
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .confirm-box p { margin: 0; font-size: 14px; }
  .confirm-actions { display: flex; gap: 8px; }

  .err { color: var(--error); font-size: 13px; margin: 0; }
</style>
