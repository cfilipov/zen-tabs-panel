<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { NavigationEntry } from "../runtime/history-client";
  import { domainOf } from "../views/url";

  type Props = {
    entry: NavigationEntry;
    index: number;
    currentIndex: number;
    selectedIndex?: number;
    badge?: string | null;
    onactivate?: (index: number) => void;
  };

  let { entry, index, currentIndex, selectedIndex = -1, badge = null, onactivate }: Props = $props();
  const isCurrent = $derived(index === currentIndex);
  const selected = $derived(index === selectedIndex);
  const domain = $derived(domainOf(entry.url));
  const title = $derived(entry.title || entry.url || "Untitled");
  const direction = $derived(index < currentIndex ? "\u2190 " : index > currentIndex ? "\u2192 " : "\u25cf ");
  const stepBadge = $derived(index === currentIndex - 1 ? "B" : index === currentIndex + 1 ? "F" : null);
</script>

<button
  type="button"
  class="list-item"
  class:nav-current={isCurrent}
  class:selected
  data-nav-index={index}
  disabled={isCurrent}
  onclick={() => !isCurrent && onactivate?.(index)}
>
  <span class="item-icon-placeholder nav-direction">{direction}</span>
  <span class="item-text">
    <span class="item-title">{title}</span>
    {#if domain}
      <span class="item-subtitle">{domain}</span>
    {/if}
  </span>
  <span class="item-right">
    <Badge value={stepBadge} />
    <Badge value={badge} />
  </span>
</button>
