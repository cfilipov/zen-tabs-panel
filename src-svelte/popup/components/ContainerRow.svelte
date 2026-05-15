<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { ContainerRow } from "../runtime/container-client";

  type Props = {
    row: ContainerRow;
    badge?: string | null;
    selected?: boolean;
    onactivate?: (row: ContainerRow) => void;
  };

  let { row, badge = null, selected = false, onactivate }: Props = $props();
</script>

<button
  type="button"
  class="list-item"
  class:selected
  data-user-context-id={row.userContextId}
  onclick={() => onactivate?.(row)}
>
  {#if row.iconUrl}
    <span
      class="container-icon"
      style={`background-color:${row.colorCode};mask-image:url(${row.iconUrl});-webkit-mask-image:url(${row.iconUrl})`}
    ></span>
  {:else}
    <span class="item-icon-placeholder"></span>
  {/if}
  <span class="item-text">
    <span class="item-title">{row.name}</span>
  </span>
  <span class="item-right">
    <Badge value={badge} />
  </span>
</button>
