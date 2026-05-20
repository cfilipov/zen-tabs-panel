<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  export type SidebarHint = {
    id: string;
    label: string;
    badge: string;
    hidden?: boolean;
    onclick: () => void;
  };

  type Props = {
    hidden?: boolean;
    hints?: SidebarHint[];
    hintsOnly?: boolean;
    sortLabel?: string | null;
    workspaces?: WorkspaceRow[];
    workspaceFilter?: string;
    activeWorkspaceId?: string | null;
    element?: HTMLDivElement;
    onSort?: () => void;
    onWorkspaceFilter?: (workspaceId: string) => void;
  };

  let {
    hidden = true,
    hints = [],
    hintsOnly = false,
    sortLabel = null,
    workspaces = [],
    workspaceFilter = "all",
    activeWorkspaceId = null,
    element = $bindable(),
    onSort,
    onWorkspaceFilter,
  }: Props = $props();

  const visibleHints = $derived(hints.filter((hint) => !hint.hidden));

  function hintClass(hint: SidebarHint) {
    if (hint.id === "close-all") return "sidebar-close-all-hint";
    if (hint.id === "restore") return "sidebar-restore-hint";
    if (hint.id === "children") return "sidebar-children-hint";
    return "sidebar-close-hint";
  }
</script>

<div id="sidebar" class:hidden class:sidebar-hints-only={hintsOnly} bind:this={element}>
  {#each hints as hint (hint.id)}
    <button
      type="button"
      class={`${hintClass(hint)}${hint.hidden ? " hidden" : ""}`}
      onclick={hint.onclick}
    >
      <span class="sidebar-ws-name">{hint.label}</span>
      <Badge value={hint.badge} />
    </button>
  {/each}

  {#if !hintsOnly}
    {#if visibleHints.length > 0}
      <div class="sidebar-sep"></div>
    {/if}

    {#if sortLabel}
      <button type="button" class="sidebar-sort" onclick={() => onSort?.()}>
        <span class="sidebar-ws-name">{sortLabel}</span>
        <Badge value="S" />
      </button>
    {/if}

    {#if workspaces.length > 0}
      <div class="sidebar-heading">Filter by workspace</div>
      <button
        type="button"
        class="sidebar-item"
        class:active={workspaceFilter === "all"}
        onclick={() => onWorkspaceFilter?.(workspaceFilter === "all" ? activeWorkspaceId || "all" : "all")}
      >
        <span class="sidebar-ws-name">All</span>
        <Badge value="0" />
      </button>
      {#each workspaces as workspace, index (workspace.uuid)}
        <button
          type="button"
          class="sidebar-item"
          class:active={workspaceFilter === workspace.uuid}
          onclick={() => onWorkspaceFilter?.(workspaceFilter === workspace.uuid ? "all" : workspace.uuid)}
        >
          {#if workspace.svgContent}
            <span class="sidebar-ws-icon">{@html workspace.svgContent}</span>
          {/if}
          <span class="sidebar-ws-name">{workspace.name}</span>
          <Badge value={index < 9 ? `⇧${index + 1}` : null} />
        </button>
      {/each}
    {/if}
  {/if}
</div>
