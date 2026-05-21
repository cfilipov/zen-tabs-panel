<script lang="ts">
  import Badge from "../components/Badge.svelte";
  import type { DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";
  import { formatDuration } from "./format";

  type Props = {
    group: DuplicateGroupRow;
    workspaces?: WorkspaceRow[];
    title?: string;
    limit?: number;
    selectedIndex?: number;
    shortcutForIndex?: (index: number) => string | null;
    onactivate?: (row: TabIndexRow, index: number) => void;
    onclose?: (row: TabIndexRow) => void;
    onpreview?: (row: TabIndexRow) => void;
    onclearpreview?: () => void;
  };

  let {
    group,
    workspaces = [],
    title,
    limit,
    selectedIndex = -1,
    shortcutForIndex,
    onactivate,
    onclose,
    onpreview,
    onclearpreview,
  }: Props = $props();

  const now = $derived(Date.now());
  const activeWorkspaceId = $derived(workspaces.find((workspace) => workspace.isActive)?.uuid ?? null);
  const workspaceById = $derived(new Map(workspaces.map((workspace) => [workspace.uuid, workspace])));
  const tabs = $derived(typeof limit === "number" ? group.tabs.slice(0, limit) : group.tabs);

  function tabAge(row: TabIndexRow) {
    const created = Number.parseInt(row.domId.split("-")[0] || "", 10);
    return formatDuration(now - created);
  }

  function workspaceName(row: TabIndexRow) {
    return row.workspaceId ? workspaceById.get(row.workspaceId)?.name ?? "" : "";
  }

  function workspaceIcon(row: TabIndexRow) {
    return row.workspaceId ? workspaceById.get(row.workspaceId)?.svgContent ?? "" : "";
  }

  function workspaceNote(row: TabIndexRow) {
    if (row.active) return "(this tab)";
    if (row.workspaceId && row.workspaceId === activeWorkspaceId) return "(this workspace)";
    return "";
  }
</script>

<section class="dup-group">
  <div class="dup-group-header">
    {#if group.favIconUrl}
      <img class="dup-group-favicon" src={group.favIconUrl} alt="" loading="eager" decoding="sync" />
    {:else}
      <span class="dup-group-favicon-placeholder">○</span>
    {/if}
    <div class="dup-group-text">
      <div class="dup-group-title">{title || group.title || "Untitled"}<span class="item-count">{group.tabs.length}</span></div>
      {#if group.domain && !title}
        <div class="dup-group-domain">{group.domain}</div>
      {/if}
    </div>
  </div>
  <div class="duplicate-tab-grid">
    {#each tabs as tab, index (tab.domId)}
      {@const shortcut = shortcutForIndex?.(index) ?? null}
      <button
        type="button"
        class="duplicate-tab-row"
        class:selected={index === selectedIndex}
        class:dup-self={tab.active}
        class:tab-pending={tab.pending}
        data-dom-id={tab.domId}
        onmouseenter={() => onpreview?.(tab)}
        onmouseleave={() => onclearpreview?.()}
        onclick={() => {
          if (!tab.active) onactivate?.(tab, index);
        }}
      >
        <span class="dup-workspace">
          {#if workspaceIcon(tab)}
            <span class="dup-ws-icon">{@html workspaceIcon(tab)}</span>
          {/if}
          {workspaceName(tab)}
          {#if workspaceNote(tab)}
            <span class="dup-ws-note">{workspaceNote(tab)}</span>
          {/if}
        </span>
        <span class="dup-age">open for {tabAge(tab)}</span>
        <span class="duplicate-tab-actions">
          <span class="item-badge-stack">
            {#if shortcut}
              <Badge value={shortcut} />
            {:else}
              <span class="item-badge-placeholder"></span>
            {/if}
            {#if !tab.active}
              <span
                role="button"
                tabindex="-1"
                class="item-close"
                title="Close tab"
                onkeydown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onclose?.(tab);
                }}
                onclick={(event) => {
                  event.stopPropagation();
                  onclose?.(tab);
                }}
              >✕</span>
            {/if}
          </span>
        </span>
      </button>
    {/each}
  </div>
</section>
