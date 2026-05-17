<script lang="ts">
  import RecentlyClosedRowView from "../components/RecentlyClosedRow.svelte";
  import type { RecentlyClosedRow } from "../runtime/history-client";

  type Props = {
    rows: RecentlyClosedRow[];
    selectedIndex?: number;
    onactivate?: (row: RecentlyClosedRow) => void;
    onrestore?: (row: RecentlyClosedRow) => void;
  };

  let { rows, selectedIndex = -1, onactivate, onrestore }: Props = $props();
</script>

{#if rows.length === 0}
  <div class="empty-state">No recently closed tabs</div>
{:else}
  {#each rows as row, index (row.sessionId)}
    <RecentlyClosedRowView
      {row}
      {index}
      {selectedIndex}
      badge={index < 9 ? String(index + 1) : null}
      onactivate={onactivate}
      onrestore={onrestore}
    />
  {/each}
{/if}
