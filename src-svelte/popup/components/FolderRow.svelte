<script lang="ts">
  import Badge from "./Badge.svelte";
  import { iconHtml } from "./icons";
  import type { FolderRow } from "../runtime/folder-client";

  type Props = {
    row: FolderRow;
    index?: number;
    selectedIndex?: number;
    badge?: string | null;
    workspaceName?: string | null;
    onactivate?: (row: FolderRow) => void;
  };

  let { row, index = -1, selectedIndex = -1, badge = null, workspaceName = null, onactivate }: Props = $props();
  const selected = $derived(index === selectedIndex);
</script>

<button
  type="button"
  class="list-item"
  class:selected
  data-folder-id={row.id}
  onclick={() => onactivate?.(row)}
>
  <span class="item-icon-placeholder">{@html iconHtml("svg:folder")}</span>
  <span class="item-text">
    <span class="item-title">{row.name}</span>
  </span>
  <span class="item-right">
    {#if workspaceName}
      <span class="row-workspace">{workspaceName}</span>
    {/if}
    <Badge value={badge} />
  </span>
</button>
