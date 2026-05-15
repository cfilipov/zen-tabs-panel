<script lang="ts">
  import ContainerRowView from "../components/ContainerRow.svelte";
  import type { ContainerRow } from "../runtime/container-client";

  type Props = {
    rows: ContainerRow[];
    selectedIndex?: number;
    onactivate?: (row: ContainerRow) => void;
  };

  let { rows, selectedIndex = -1, onactivate }: Props = $props();
</script>

{#if rows.length === 0}
  <div class="empty-state">No containers configured</div>
{:else}
  {#each rows as row, index (row.cookieStoreId)}
    <ContainerRowView
      {row}
      badge={index < 9 ? String(index + 1) : null}
      selected={index === selectedIndex}
      onactivate={onactivate}
    />
  {/each}
{/if}
