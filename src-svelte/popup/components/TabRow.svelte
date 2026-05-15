<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { TabIndexRow } from "../runtime/tab-index-client";

  type Props = {
    row: TabIndexRow;
    badge?: string | null;
    selected?: boolean;
    onactivate?: (row: TabIndexRow) => void;
    onpreview?: (row: TabIndexRow) => void;
    onclearpreview?: () => void;
  };

  let { row, badge = null, selected = false, onactivate, onpreview, onclearpreview }: Props = $props();
  const title = $derived(row.title || "Untitled");
</script>

<button
  type="button"
  class="list-item"
  class:tab-pending={row.pending}
  class:selected
  data-dom-id={row.domId}
  onclick={() => onactivate?.(row)}
  onmouseenter={() => onpreview?.(row)}
  onmouseleave={() => onclearpreview?.()}
>
  {#if row.favIconUrl}
    <img class="item-icon" src={row.favIconUrl} alt="" />
  {:else}
    <span class="item-icon-placeholder">○</span>
  {/if}
  <span class="item-text">
    <span class="item-title">
      {#if row.essential}
        <span class="tab-indicator essential" title="Essential">★</span>
      {:else if row.pinned}
        <span class="tab-indicator pinned" title="Pinned">⌖</span>
      {/if}
      {title}
    </span>
    {#if row.domain}
      <span class="item-subtitle">
        <span class="subtitle-domain">{row.domain}</span>
      </span>
    {/if}
  </span>
  <span class="item-right">
    <span class="item-badge-stack">
      <Badge value={badge} />
      <span class="item-close" title="Close tab">✕</span>
    </span>
  </span>
</button>
