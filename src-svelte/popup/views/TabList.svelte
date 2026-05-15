<script lang="ts">
  import TabRow from "../components/TabRow.svelte";
  import VirtualList from "../components/VirtualList.svelte";
  import type { TabIndexRow } from "../runtime/tab-index-client";

  type Props = {
    rows: TabIndexRow[];
    total: number;
    offset?: number;
    onactivate?: (row: TabIndexRow) => void;
    onpreview?: (row: TabIndexRow) => void;
    onclearpreview?: () => void;
  };

  let { rows, total, offset = 0, onactivate, onpreview, onclearpreview }: Props = $props();
</script>

{#if total === 0}
  <div class="empty-state">No tabs</div>
{:else}
  <VirtualList {rows} {total}>
    {#snippet children(row: TabIndexRow, index: number)}
      <TabRow
        {row}
        badge={offset + index < 9 ? String(offset + index + 1) : null}
        onactivate={onactivate}
        onpreview={onpreview}
        onclearpreview={onclearpreview}
      />
    {/snippet}
  </VirtualList>
{/if}
