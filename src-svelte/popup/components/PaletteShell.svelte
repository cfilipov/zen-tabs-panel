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
    fitContentHeight?: boolean;
    onSidebarSort?: () => void;
    onWorkspaceFilter?: (workspaceId: string) => void;
    onPage?: (page: number) => void;
    onheightchange?: (height: number) => void;
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
    fitContentHeight = false,
    onSidebarSort,
    onWorkspaceFilter,
    onPage,
    onheightchange,
  }: Props = $props();

  let paletteHeight = $state(0);
  let paletteElement = $state<HTMLDivElement | undefined>();
  let listElement = $state<HTMLDivElement | undefined>();
  const pages = $derived(Array.from({ length: Math.max(0, pageCount) }, (_, index) => index + 1));

  function reportHeight() {
    if (!paletteElement) return;
    const height = fitContentHeight
      ? Math.max(paletteElement.scrollHeight, paletteElement.getBoundingClientRect().height)
      : paletteElement.clientHeight;
    if (height > 0) onheightchange?.(height);
  }

  $effect(() => {
    if (paletteHeight > 0) reportHeight();
  });

  $effect(() => {
    fitContentHeight;
    if (!paletteElement) return;

    let frame: number | null = null;
    const scheduleReport = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        reportHeight();
      });
    };
    const observer = new ResizeObserver(scheduleReport);
    observer.observe(paletteElement);
    if (listElement) observer.observe(listElement);
    scheduleReport();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });
</script>

<div id="palette" class:fit-content-height={fitContentHeight} bind:this={paletteElement} bind:clientHeight={paletteHeight}>
  <Header hidden={headerHidden} {title} {hint} {onback} />
  <div id="content">
    <div id="list" bind:this={listElement}>
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
