<script lang="ts">
  import DomainRow from "../components/DomainRow.svelte";
  import VirtualList from "../components/VirtualList.svelte";
  import type { DomainIndexRow } from "../runtime/tab-index-client";

  type Props = {
    rows: DomainIndexRow[];
    total: number;
    offset?: number;
    skipAnimations?: boolean;
    selectedDomain?: string | null;
    onactivate?: (index: number) => void;
    onclose?: (row: DomainIndexRow) => void;
    onrange?: (offset: number, limit: number) => void;
  };

  let { rows, total, offset = 0, skipAnimations = false, selectedDomain = null, onactivate, onclose, onrange }: Props = $props();
</script>

{#if total === 0}
  <div class="empty-state">No domains</div>
{:else}
  <VirtualList {rows} {total} {offset} {skipAnimations} getKey={(row) => row.domain} onrange={onrange}>
    {#snippet children(row: DomainIndexRow, index: number)}
      <DomainRow
        {row}
        index={offset + index}
        badge={offset + index < 9 ? String(offset + index + 1) : null}
        {selectedDomain}
        onactivate={onactivate}
        onclose={onclose}
      />
    {/snippet}
  </VirtualList>
{/if}
