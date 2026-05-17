<script lang="ts">
  import Badge from "./Badge.svelte";
  import { iconHtml } from "./icons";
  import type { ActionMenuItem } from "../views/actions-model";

  type Props = {
    item: ActionMenuItem;
    compact?: boolean;
    onactivate?: (item: ActionMenuItem) => void;
  };

  let { item, compact = false, onactivate }: Props = $props();
  const icon = $derived(item.iconHtml
    ? item.iconHtml
    : item.kind === "workspace-switch" && item.workspaceIconHtml
    ? `<span class="workspace-icon">${item.workspaceIconHtml}</span>`
    : iconHtml(item.icon));
  const selected = $derived(Boolean(item.selected));
</script>

<button
  type="button"
  class="list-item"
  class:compact-item={compact}
  class:disabled={item.disabled}
  class:selected
  data-id={item.id}
  disabled={item.disabled}
  onclick={() => onactivate?.(item)}
>
  <span class="item-icon-placeholder">{@html icon}</span>
  <span class="item-text">
    <span class="item-title">
      {item.label}
      {#if item.kind === "workspace-switch" || (item.count ?? 0) > 0}
        <span class="item-count">{item.count ?? 0}</span>
      {/if}
    </span>
  </span>
  <span class="item-right">
    <Badge value={item.badge} />
    <span class="item-arrow">{item.isView ? "›" : ""}</span>
  </span>
</button>
