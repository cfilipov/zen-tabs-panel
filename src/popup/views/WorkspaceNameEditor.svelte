<script lang="ts">
  import { tick } from "svelte";

  type Props = {
    name: string;
    onsave?: (name: string) => void | Promise<void>;
  };

  let { name, onsave }: Props = $props();
  let draft = $state("");
  let input: HTMLInputElement | null = $state(null);
  let saving = $state(false);

  const trimmed = $derived(draft.trim());
  const changed = $derived(trimmed.length > 0 && trimmed !== name.trim());

  async function save() {
    if (!changed || saving) return;
    saving = true;
    try {
      await onsave?.(trimmed);
    } finally {
      saving = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") return;
    event.stopPropagation();
  }

  $effect(() => {
    name;
    draft = name;
    void tick().then(() => {
      input?.focus();
      input?.select();
    });
  });
</script>

<form
  class="workspace-name-editor"
  onsubmit={(event) => {
    event.preventDefault();
    void save();
  }}
>
  <label class="workspace-name-label" for="workspace-name-input">Workspace name</label>
  <input
    id="workspace-name-input"
    bind:this={input}
    class="workspace-name-input"
    bind:value={draft}
    autocomplete="off"
    spellcheck="false"
    maxlength="80"
    onkeydown={handleKeydown}
  />
  <div class="workspace-name-actions">
    <button class="workspace-name-save" type="submit" disabled={!changed || saving}>Save</button>
  </div>
</form>
