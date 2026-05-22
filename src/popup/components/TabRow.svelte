<script lang="ts">
  import Badge from "./Badge.svelte";
  import { iconHtml } from "./icons";
  import type { TabIndexRow } from "../runtime/tab-index-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type Props = {
    row: TabIndexRow;
    index?: number;
    badge?: string | null;
    subtitle?: string | null;
    selectedDomId?: string | null;
    workspaces?: WorkspaceRow[];
    activeWorkspaceId?: string | null;
    onactivate?: (index: number) => void;
    ondrillchildren?: (row: TabIndexRow) => void;
    onclose?: (row: TabIndexRow) => void;
    onpreview?: (row: TabIndexRow) => void;
    onclearpreview?: () => void;
  };

  let {
    row,
    index = -1,
    badge = null,
    subtitle = null,
    selectedDomId = null,
    workspaces = [],
    activeWorkspaceId = null,
    onactivate,
    ondrillchildren,
    onclose,
    onpreview,
    onclearpreview,
  }: Props = $props();
  const title = $derived(row.title || "Untitled");
  const childLabel = $derived(
    row.childCount != null ? `${row.childCount} ${row.childCount === 1 ? "child" : "children"}` : null,
  );
  const hasSubtitle = $derived(Boolean(row.domain || subtitle || childLabel));
  const selected = $derived(row.domId === selectedDomId);
  const workspace = $derived(row.workspaceId ? workspaces.find((item) => item.uuid === row.workspaceId) : null);
  const showWorkspace = $derived(Boolean(workspace && row.workspaceId && row.workspaceId !== activeWorkspaceId));

  function handleClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".subtitle-children")) {
      ondrillchildren?.(row);
      return;
    }
    onactivate?.(index);
  }

  function closeRow(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    onclose?.(row);
  }
</script>

<button
  type="button"
  class="list-item tab-list-row"
  class:tab-pending={row.pending}
  class:selected
  data-dom-id={row.domId}
  onclick={handleClick}
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
        {#if childLabel}
          <span class="subtitle-age subtitle-pill subtitle-children">
            {childLabel}
          </span>
        {/if}
      </span>
    {/if}
  </span>
  <span class="item-right">
    {#if showWorkspace && workspace}
      <span class="row-workspace">
        {#if workspace.svgContent}
          <span class="row-ws-icon">{@html workspace.svgContent}</span>
        {/if}
        {workspace.name}
      </span>
    {/if}
    <span class="item-badge-stack">
      <Badge value={badge} />
      <span
        role="button"
        tabindex="-1"
        class="item-close"
        title="Close tab"
        onkeydown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          closeRow(event);
        }}
        onclick={closeRow}
      >✕</span>
    </span>
  </span>
</button>
