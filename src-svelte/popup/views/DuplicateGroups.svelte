<script lang="ts">
  import type { DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";
  import { formatDuration } from "./format";

  type Props = {
    groups: DuplicateGroupRow[];
    workspaces?: WorkspaceRow[];
    onactivate?: (row: TabIndexRow) => void;
    onclose?: (row: TabIndexRow) => void;
    onpreview?: (row: TabIndexRow) => void;
    onclearpreview?: () => void;
  };

  let {
    groups,
    workspaces = [],
    onactivate,
    onclose,
    onpreview,
    onclearpreview,
  }: Props = $props();

  const now = $derived(Date.now());
  const activeWorkspaceId = $derived(workspaces.find((workspace) => workspace.isActive)?.uuid ?? null);
  const workspaceById = $derived(new Map(workspaces.map((workspace) => [workspace.uuid, workspace])));

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

{#if groups.length === 0}
  <div class="empty-state">No duplicates</div>
{:else}
  {#each groups as group (group.url)}
    <section class="dup-group">
      <div class="dup-group-header">
        {#if group.favIconUrl}
          <img class="dup-group-favicon" src={group.favIconUrl} alt="" />
        {:else}
          <span class="dup-group-favicon-placeholder">○</span>
        {/if}
        <div class="dup-group-text">
          <div class="dup-group-title">{group.title || "Untitled"}<span class="item-count">{group.tabs.length}</span></div>
          {#if group.domain}
            <div class="dup-group-domain">{group.domain}</div>
          {/if}
        </div>
      </div>
      <div class="info-duplicates-grid">
        {#each group.tabs as tab, index (tab.domId)}
          <button
            type="button"
            class="info-duplicate-row"
            class:dup-self={tab.active}
            class:tab-pending={tab.pending}
            data-dom-id={tab.domId}
            onmouseenter={() => onpreview?.(tab)}
            onmouseleave={() => onclearpreview?.()}
            onclick={() => {
              if (!tab.active) onactivate?.(tab);
            }}
          >
            <span class="dup-index">{index + 1}</span>
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
            {#if !tab.active}
              <span
                role="button"
                tabindex="-1"
                class="dup-close"
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
            {:else}
              <span></span>
            {/if}
          </button>
        {/each}
      </div>
    </section>
  {/each}
{/if}
