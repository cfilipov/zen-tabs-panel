<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type Props = {
    row: WorkspaceRow;
    index?: number;
    selectedIndex?: number;
    badge?: string | null;
    onactivate?: (row: WorkspaceRow, switchToTarget?: boolean) => void;
  };

  let { row, index = -1, selectedIndex = -1, badge = null, onactivate }: Props = $props();
  const selected = $derived(index === selectedIndex);
</script>

<button
  type="button"
  class="list-item"
  class:selected
  class:disabled={row.isActive}
  data-workspace-id={row.uuid}
  disabled={row.isActive}
  onclick={(event) => {
    if (!row.isActive) onactivate?.(row, event.shiftKey);
  }}
>
  {#if row.svgContent}
    <span class="workspace-icon">{@html row.svgContent}</span>
  {:else}
    <span class="item-icon-placeholder">○</span>
  {/if}
  <span class="item-text">
    <span class="item-title">{row.name}</span>
  </span>
  <span class="item-right">
    {#if row.isActive}
      <Badge value="Current" />
    {/if}
    <Badge value={badge} />
  </span>
</button>
