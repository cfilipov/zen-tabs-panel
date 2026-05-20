<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { ContainerRow } from "../runtime/container-client";

  type Props = {
    row: ContainerRow;
    index?: number;
    selectedIndex?: number;
    badge?: string | null;
    onactivate?: (index: number) => void;
  };

  let { row, index = -1, selectedIndex = -1, badge = null, onactivate }: Props = $props();
  const selected = $derived(index === selectedIndex);
</script>

<button
  type="button"
  class="list-item"
  class:selected
  data-user-context-id={row.userContextId}
  onclick={() => onactivate?.(index)}
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
