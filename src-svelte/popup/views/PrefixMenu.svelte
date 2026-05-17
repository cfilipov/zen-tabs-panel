<script lang="ts">
  import { iconHtml } from "../components/icons";
  import type { ActionMenuItem } from "./actions-model";
  import type { ViewId } from "../../shared/types";

  type Props = {
    view: ViewId;
    items: ActionMenuItem[];
    onactivate?: (item: ActionMenuItem) => void;
  };

  let { view, items, onactivate }: Props = $props();
  const twoColumn = $derived(view === "reorder-tabs" || view === "close-and-select");

  function actionIcon(item: ActionMenuItem) {
    if (item.iconHtml) return item.iconHtml;
    if (item.kind === "workspace-switch" && item.workspaceIconHtml) {
      return `<span class="workspace-icon">${item.workspaceIconHtml}</span>`;
    }
    return iconHtml(item.icon);
  }

  function badgeLabel(value: string | null | undefined) {
    return value ? String(value) : "";
  }
</script>

{#snippet Badge(value: string | null | undefined)}
  {@const label = badgeLabel(value)}
  <span class={`item-badge${label.length > 1 ? " badge-wide" : ""}`} hidden={!label}>{label}</span>
{/snippet}

{#snippet ActionItem(item: ActionMenuItem, compact = false)}
  <button
    type="button"
    class="list-item"
    class:compact-item={compact}
    class:disabled={item.disabled}
    class:selected={Boolean(item.selected)}
    data-id={item.id}
    disabled={item.disabled}
    onclick={() => onactivate?.(item)}
  >
    <span class="item-icon-placeholder">{@html actionIcon(item)}</span>
    <span class="item-text">
      <span class="item-title">
        {item.label}
        {#if item.kind === "workspace-switch" || (item.count ?? 0) > 0}
          <span class="item-count">{item.count ?? 0}</span>
        {/if}
      </span>
    </span>
    <span class="item-right">
      {@render Badge(item.badge)}
      <span class="item-arrow">{item.isView ? "›" : ""}</span>
    </span>
  </button>
{/snippet}

{#if twoColumn}
  <div class="actions-grid actions-grid-2col">
    {#each items as item (item.id)}
      {@render ActionItem(item, true)}
    {/each}
  </div>
{:else}
  {#each items as item (item.id)}
    {@render ActionItem(item)}
  {/each}
{/if}
