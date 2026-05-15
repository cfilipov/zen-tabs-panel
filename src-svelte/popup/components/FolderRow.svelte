<script lang="ts">
  import Badge from "./Badge.svelte";
  import { iconHtml } from "./icons";
  import type { FolderRow } from "../runtime/folder-client";

  type Props = {
    row: FolderRow;
    badge?: string | null;
    selected?: boolean;
    workspaceName?: string | null;
    onactivate?: (row: FolderRow) => void;
  };

  let { row, badge = null, selected = false, workspaceName = null, onactivate }: Props = $props();
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
