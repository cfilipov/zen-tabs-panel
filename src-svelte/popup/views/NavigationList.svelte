<script lang="ts">
  import NavigationRow from "../components/NavigationRow.svelte";
  import type { NavigationHistory } from "../runtime/history-client";

  type Props = {
    history: NavigationHistory | null;
    selectedIndex?: number;
    onactivate?: (index: number) => void;
  };

  let { history, selectedIndex = -1, onactivate }: Props = $props();
  const entries = $derived(history?.entries ?? []);
  const currentIndex = $derived(history?.index ?? -1);

  function badgeFor(index: number) {
    if (index === currentIndex) return null;
    const before = entries.slice(0, index).filter((_, i) => i !== currentIndex).length;
    return before < 9 ? String(before + 1) : null;
  }
</script>

{#if entries.length === 0}
  <div class="empty-state">No navigation history</div>
{:else}
  {#each entries as entry, index}
    <NavigationRow
      {entry}
      {index}
      {currentIndex}
      badge={badgeFor(index)}
      selected={index === selectedIndex}
      onactivate={onactivate}
    />
  {/each}
{/if}
