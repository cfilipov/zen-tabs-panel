<script lang="ts">
  import Header from "./Header.svelte";
  import Sidebar from "./Sidebar.svelte";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type SidebarHint = {
    id: string;
    label: string;
    badge: string;
    hidden?: boolean;
    onclick: () => void;
  };

  type Props = {
    children?: import("svelte").Snippet;
    headerHidden?: boolean;
    title?: string;
    hint?: string | null;
    onback?: () => void;
    sidebarHidden?: boolean;
    sidebarHints?: SidebarHint[];
    sidebarHintsOnly?: boolean;
    sidebarSortLabel?: string | null;
    sidebarWorkspaces?: WorkspaceRow[];
    workspaceFilter?: string;
    activeWorkspaceId?: string | null;
    pageIndicatorHidden?: boolean;
    pageCount?: number;
    currentPage?: number;
    onSidebarSort?: () => void;
    onWorkspaceFilter?: (workspaceId: string) => void;
    onPage?: (page: number) => void;
  };

  let {
    children,
    headerHidden = false,
    title = "",
    hint = null,
    onback,
    sidebarHidden = true,
    sidebarHints = [],
    sidebarHintsOnly = false,
    sidebarSortLabel = null,
    sidebarWorkspaces = [],
    workspaceFilter = "all",
    activeWorkspaceId = null,
    pageIndicatorHidden = true,
    pageCount = 1,
    currentPage = 1,
    onSidebarSort,
    onWorkspaceFilter,
    onPage,
  }: Props = $props();

  const pages = $derived(Array.from({ length: Math.max(0, pageCount) }, (_, index) => index + 1));
</script>

<div id="palette">
  <Header hidden={headerHidden} {title} {hint} {onback} />
  <div id="content">
    <div id="list">
      {@render children?.()}
    </div>
    <Sidebar
      hidden={sidebarHidden}
      hints={sidebarHints}
      hintsOnly={sidebarHintsOnly}
      sortLabel={sidebarSortLabel}
      workspaces={sidebarWorkspaces}
      {workspaceFilter}
      {activeWorkspaceId}
      onSort={onSidebarSort}
      {onWorkspaceFilter}
    />
  </div>
  <div id="page-indicator" class:hidden={pageIndicatorHidden}>
    {#if !pageIndicatorHidden}
      {#each pages as page (page)}
        <button
          type="button"
          class="page-dot"
          class:active={page === currentPage}
          data-page={page}
          aria-label={`Page ${page}`}
          onclick={() => onPage?.(page)}
        ></button>
      {/each}
    {/if}
  </div>
</div>
