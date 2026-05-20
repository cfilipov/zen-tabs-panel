<script lang="ts">
  import Badge from "./Badge.svelte";
  import { iconHtml } from "./icons";
  import type { ProfileRow } from "../runtime/profile-client";

  type Props = {
    row: ProfileRow;
    index?: number;
    selectedIndex?: number;
    badge?: string | null;
    onactivate?: (index: number) => void;
  };

  let { row, index = -1, selectedIndex = -1, badge = null, onactivate }: Props = $props();
  const status = $derived(row.isCurrent ? "Current" : row.isDefault ? "Default" : null);
  const selected = $derived(index === selectedIndex);
</script>

<button
  type="button"
  class="list-item"
  class:compact-item={true}
  class:selected
  class:disabled={row.isCurrent}
  aria-disabled={row.isCurrent}
  data-profile-name={row.name}
  onclick={() => {
    if (!row.isCurrent) onactivate?.(index);
  }}
>
  <span class="item-icon-placeholder">{@html iconHtml("svg:user")}</span>
  <span class="item-text">
    <span class="item-title">{row.name}</span>
  </span>
  <span class="item-right">
    <Badge value={status} />
    {#if !row.isCurrent}
      <Badge value={badge} />
    {/if}
  </span>
</button>
