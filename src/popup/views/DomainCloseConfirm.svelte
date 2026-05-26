<script lang="ts">
  import Badge from "../components/Badge.svelte";
  import { iconHtml } from "../components/icons";
  import {
    domainCloseConfirmOptionsForCounts,
    type DomainCloseConfirmAction,
  } from "../interaction/domain-close-confirm-options";

  type Props = {
    domain: string;
    count?: number;
    unpinnedCount?: number;
    pinnedCount?: number;
    selectedIndex?: number;
    onactivate?: (action: DomainCloseConfirmAction) => void;
  };

  let { domain, count = 0, unpinnedCount = 0, pinnedCount = 0, selectedIndex = 0, onactivate }: Props = $props();
  const options = $derived(domainCloseConfirmOptionsForCounts(unpinnedCount, pinnedCount));
  const subtitle = $derived(count > 0
    ? `${count} ${count === 1 ? "tab" : "tabs"} on ${domain}`
    : domain);
</script>

<div class="domain-close-summary">
  <span class="domain-close-title">Close tabs for {domain}</span>
  <span class="domain-close-subtitle">{subtitle}</span>
</div>

{#each options as option, index (option.action)}
  <button
    type="button"
    class="list-item"
    class:selected={index === selectedIndex}
    onclick={() => onactivate?.(option.action)}
  >
    <span class="item-icon-placeholder">{@html iconHtml(option.icon)}</span>
    <span class="item-text">
      <span class="item-title">{option.label}</span>
    </span>
    <span class="item-right">
      {#if typeof option.count === "number"}
        <span class="item-count">{option.count}</span>
      {/if}
      <Badge value={option.hotkey} />
    </span>
  </button>
{/each}
