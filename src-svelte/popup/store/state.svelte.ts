import type { PopupState, RowItem, WorkspaceFilter, WorkspaceInfo } from "./types";
import type { ViewId } from "../../shared/types";

export function createPopupState() {
  const state = $state<PopupState>({
    currentView: "actions",
    selectedIndex: -1,
    items: [],
    sectionStarts: [],
    sidebarFocused: false,
    sidebarSelectedIndex: -1,
    currentPage: 1,
    pageCount: 1,
    pageBounds: [],
    header: { title: "", hint: null },
    workspaceMap: {},
    activeWorkspaceId: null,
    workspaceFilter: "all",
  });

  function setView(view: ViewId) {
    state.currentView = view;
    state.selectedIndex = -1;
    state.sidebarFocused = false;
    state.sidebarSelectedIndex = -1;
    if (view === "actions") state.currentPage = 1;
  }

  function setItems(items: RowItem[], sectionStarts: number[] = [0]) {
    state.items = items;
    state.sectionStarts = sectionStarts;
    if (items.length === 0) {
      state.selectedIndex = -1;
    } else if (state.selectedIndex >= items.length) {
      state.selectedIndex = items.length - 1;
    }
  }

  function moveSelection(delta: 1 | -1) {
    if (state.items.length === 0) return;
    const [start, end] = currentPageBounds();
    const size = end - start;
    if (size <= 0) return;
    if (state.selectedIndex < start || state.selectedIndex >= end) {
      state.selectedIndex = delta > 0 ? start : end - 1;
      return;
    }
    state.selectedIndex = start + (((state.selectedIndex - start + delta) % size) + size) % size;
  }

  function setPage(page: number) {
    if (state.pageCount <= 1) return;
    if (page < 1) state.currentPage = state.pageCount;
    else if (page > state.pageCount) state.currentPage = 1;
    else state.currentPage = page;
    state.selectedIndex = -1;
  }

  function currentPageBounds(): [number, number] {
    if (state.currentView !== "actions") return [0, state.items.length];
    return state.pageBounds[state.currentPage - 1] ?? [0, state.items.length];
  }

  function setWorkspaceMap(map: Record<string, WorkspaceInfo>, activeWorkspaceId: string | null) {
    state.workspaceMap = map;
    state.activeWorkspaceId = activeWorkspaceId;
    if (state.workspaceFilter !== "all" && !map[state.workspaceFilter]) {
      state.workspaceFilter = "all";
    }
  }

  function setWorkspaceFilter(filter: WorkspaceFilter) {
    state.workspaceFilter = filter;
  }

  return {
    state,
    setView,
    setItems,
    moveSelection,
    setPage,
    currentPageBounds,
    setWorkspaceMap,
    setWorkspaceFilter,
  };
}
