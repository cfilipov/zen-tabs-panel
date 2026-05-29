<script lang="ts">
  import { tick } from "svelte";
  import ActionRow from "../components/ActionRow.svelte";
  import type { ActionMenuItem } from "./actions-model";

  type Props = {
    query: string;
    items: ActionMenuItem[];
    selectedIndex: number;
    selectionByKeyboard?: boolean;
    onquery?: (query: string) => void;
    onactivate?: (item: ActionMenuItem) => void | Promise<void>;
  };

  let { query, items, selectedIndex, selectionByKeyboard = false, onquery, onactivate }: Props = $props();
  let input: HTMLInputElement | null = $state(null);

  function handleInput(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    onquery?.(target.value);
  }

  function inputOwnsKey(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key === "Escape" || event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter") return false;
    return event.key.length === 1 ||
      event.key === "Backspace" ||
      event.key === "Delete" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight";
  }

  function handleKeydown(event: KeyboardEvent) {
    if (inputOwnsKey(event)) event.stopPropagation();
  }

  $effect(() => {
    void tick().then(() => {
      input?.focus();
      input?.select();
    });
  });
</script>

<div class="command-palette-view" class:keyboard-selection={selectionByKeyboard}>
  <input
    bind:this={input}
    class="command-palette-input"
    type="search"
    placeholder="Search commands"
    autocomplete="off"
    spellcheck="false"
    value={query}
    oninput={handleInput}
    onkeydown={handleKeydown}
  />

  <div id="list" class="command-palette-list">
    {#if items.length === 0}
      <div class="empty-state">No commands found</div>
    {:else}
      {#each items as item, index (item.id)}
        <ActionRow
          item={{ ...item, selected: index === selectedIndex }}
          onactivate={onactivate}
        />
      {/each}
    {/if}
  </div>
</div>
