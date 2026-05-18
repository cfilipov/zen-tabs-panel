<script lang="ts">
  import Badge from "./Badge.svelte";
  import { iconHtml } from "./icons";
  import type { TabIndexRow } from "../runtime/tab-index-client";

  type Props = {
    row: TabIndexRow;
    badge?: string | null;
    subtitle?: string | null;
    selectedDomId?: string | null;
    onactivate?: (row: TabIndexRow) => void;
    onpreview?: (row: TabIndexRow) => void;
    onclearpreview?: () => void;
  };

  let { row, badge = null, subtitle = null, selectedDomId = null, onactivate, onpreview, onclearpreview }: Props = $props();
  const title = $derived(row.title || "Untitled");
  const hasSubtitle = $derived(Boolean(row.domain || subtitle));
  const selected = $derived(row.domId === selectedDomId);
</script>

<button
  type="button"
  class="list-item tab-list-row"
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
        <span class="tab-indicator essential" title="Essential">{@html iconHtml("svg:star")}</span>
      {:else if row.pinned}
        <span class="tab-indicator pinned" title="Pinned">{@html iconHtml("svg:pin")}</span>
      {/if}
      {title}
    </span>
    {#if hasSubtitle}
      <span class="item-subtitle">
        {#if row.domain}
          <span class="subtitle-domain">{row.domain}</span>
        {/if}
        {#if subtitle}
          <span class="subtitle-age subtitle-pill">{subtitle}</span>
        {/if}
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
