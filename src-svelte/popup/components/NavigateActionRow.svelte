<script lang="ts">
  import Badge from "./Badge.svelte";
  import { iconHtml } from "./icons";
  import { domainOf } from "../views/url";
  import type { ActionMenuItem } from "../views/actions-model";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type Props = {
    item: ActionMenuItem;
    selected?: boolean;
    workspaces?: WorkspaceRow[];
    onactivate?: (item: ActionMenuItem) => void;
    onpreview?: (domId: string) => void;
    onclearpreview?: () => void;
  };

  let { item, selected = false, workspaces = [], onactivate, onpreview, onclearpreview }: Props = $props();
  const preview = $derived(item.preview ?? null);
  const disabled = $derived(item.disabled || !preview);
  const workspace = $derived(preview?.workspaceId ? workspaces.find((row) => row.uuid === preview.workspaceId) : null);
  const historyDomain = $derived(preview?.isHistory ? domainOf(preview.url || "") : "");
  const showWorkspace = $derived(Boolean(workspace && !preview?.isHistory));
  const showHistoryDomain = $derived(Boolean(historyDomain));
</script>

<button
  type="button"
  class="navigate-cell list-item compact-item"
  class:disabled
  class:selected
  class:tab-pending={preview?.pending}
  data-id={item.id}
  disabled={disabled}
  onclick={() => {
    if (!disabled) onactivate?.(item);
  }}
  onmouseenter={() => {
    if (preview?.domId) onpreview?.(preview.domId);
  }}
  onmouseleave={() => onclearpreview?.()}
>
  <span class="item-icon-placeholder">{@html item.iconHtml ?? iconHtml(item.icon)}</span>
  <span class="navigate-cell-label">{item.label}</span>
  <span class="navigate-cell-title">
    {#if preview && !preview.isHistory && preview.favIconUrl}
      <img class="navigate-cell-favicon" src={preview.favIconUrl} alt="" />
    {/if}
    {#if preview?.essential}
      <span class="tab-indicator essential" title="Essential">{@html iconHtml("svg:star")}</span>
    {:else if preview?.pinned}
      <span class="tab-indicator pinned" title="Pinned">{@html iconHtml("svg:pin")}</span>
    {/if}
    {preview?.title ?? ""}
  </span>
  {#if showWorkspace && workspace}
    <span class="row-workspace">
      {#if workspace.svgContent}
        <span class="row-ws-icon">{@html workspace.svgContent}</span>
      {/if}
      {workspace.name}
    </span>
  {:else if showHistoryDomain}
    <span class="row-workspace">{historyDomain}</span>
  {/if}
  <Badge value={item.badge} />
</button>
