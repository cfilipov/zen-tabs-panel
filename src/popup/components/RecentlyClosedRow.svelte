<script lang="ts">
  import Badge from "./Badge.svelte";
  import { iconHtml } from "./icons";
  import type { RecentlyClosedRow } from "../runtime/history-client";
  import { domainOf } from "../views/url";

  type Props = {
    row: RecentlyClosedRow;
    index?: number;
    selectedIndex?: number;
    badge?: string | null;
    onactivate?: (index: number) => void;
    onrestore?: (row: RecentlyClosedRow) => void;
  };

  let { row, index = -1, selectedIndex = -1, badge = null, onactivate, onrestore }: Props = $props();
  const title = $derived(row.title || row.url || "Untitled");
  const domain = $derived(domainOf(row.url));
  const selected = $derived(index === selectedIndex);

  function activateFromKeyboard(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onactivate?.(index);
  }

  function restoreFromKeyboard(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onrestore?.(row);
  }
</script>

<div
  role="button"
  tabindex="-1"
  class="list-item tab-list-row"
  class:selected
  data-session-id={row.sessionId}
  onclick={() => onactivate?.(index)}
  onkeydown={activateFromKeyboard}
>
  {#if row.favIconUrl}
    <img class="item-icon" src={row.favIconUrl} alt="" />
  {:else}
    <span class="item-icon-placeholder">○</span>
  {/if}
  <span class="item-text">
    <span class="item-title">
      {#if row.pinned}
        <span class="tab-indicator pinned" title="Pinned">{@html iconHtml("svg:pin")}</span>
      {/if}
      {title}
    </span>
    {#if domain}
      <span class="item-subtitle">
        <span class="subtitle-domain">{domain}</span>
      </span>
    {/if}
  </span>
  <span class="item-right">
    <span class="item-badge-stack">
      <Badge value={badge} />
      <span
        role="button"
        tabindex="-1"
        class="item-restore"
        title="Restore tab (keeps menu open)"
        onclick={(event) => {
          event.stopPropagation();
          onrestore?.(row);
        }}
        onkeydown={restoreFromKeyboard}
      >↺</span>
    </span>
  </span>
</div>
