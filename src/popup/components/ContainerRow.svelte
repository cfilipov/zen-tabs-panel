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
  const displayName = $derived(row.name || defaultContainerName(row.userContextId));
  const iconUrl = $derived(normalizedIconUrl(row.iconUrl, row.iconName));
  const colorCode = $derived(row.colorCode || "currentColor");

  function defaultContainerName(userContextId: number) {
    return ({
      1: "Personal",
      2: "Work",
      3: "Banking",
      4: "Shopping",
    } as Record<number, string>)[userContextId] || "";
  }

  function normalizedIconUrl(value: string, iconName = "") {
    if (value && value.includes("/")) return value;
    const name = iconName || value;
    return name ? `resource://usercontext-content/${name}.svg` : "";
  }
</script>

<button
  type="button"
  class="list-item"
  class:selected
  data-user-context-id={row.userContextId}
  onclick={() => onactivate?.(index)}
>
  {#if iconUrl}
    <span
      class="container-icon"
      style={`background-color:${colorCode};mask-image:url(${iconUrl});-webkit-mask-image:url(${iconUrl})`}
    ></span>
  {:else}
    <span class="item-icon-placeholder"></span>
  {/if}
  <span class="item-text">
    <span class="item-title">{displayName}</span>
  </span>
  <span class="item-right">
    <Badge value={badge} />
  </span>
</button>
