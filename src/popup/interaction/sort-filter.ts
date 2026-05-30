import type { ViewId } from "../../shared/types";
import type { WorkspaceRow } from "../runtime/workspace-client";
import type { NativeListView } from "../view-loaders/view-registry";

export type SortState = {
  domainsSortAlpha: boolean;
  tabsByAgeNewestFirst: boolean;
};

export type SortReloadView = Extract<ViewId, "domains" | "domain-tabs" | "tabs-by-age">;

export type SortToggleResult = SortState & {
  reloadView: SortReloadView | null;
};

export function toggleSortForView(view: ViewId, state: SortState): SortToggleResult {
  if (view === "domains" || view === "domain-tabs") {
    return {
      ...state,
      domainsSortAlpha: !state.domainsSortAlpha,
      reloadView: view,
    };
  }
  if (view === "tabs-by-age") {
    return {
      ...state,
      tabsByAgeNewestFirst: !state.tabsByAgeNewestFirst,
      reloadView: "tabs-by-age",
    };
  }
  return { ...state, reloadView: null };
}

export function listViewParams(
  view: NativeListView,
  options: SortState & {
    workspaceFilter: string;
    currentDomain: string | null;
    searchQuery?: string;
  },
) {
  const params: Record<string, unknown> = {};
  if (options.workspaceFilter !== "all") params.workspaceId = options.workspaceFilter;
  if (view === "domain-tabs" && options.currentDomain) params.domain = options.currentDomain;
  if (view === "domains") params.sortAlpha = options.domainsSortAlpha;
  if (view === "tabs-by-age") params.newestFirst = options.tabsByAgeNewestFirst;
  if (options.searchQuery) params.searchQuery = options.searchQuery;
  return params;
}

export function normalizeWorkspaceFilter(nextFilter: string) {
  return nextFilter || "all";
}

export function toggleWorkspaceFilterValue(currentFilter: string, activeWorkspaceId: string | null) {
  return currentFilter === "all" ? activeWorkspaceId || "all" : "all";
}

export function workspaceFilterByIndex(
  currentFilter: string,
  workspaces: readonly Pick<WorkspaceRow, "uuid">[],
  index: number,
) {
  const workspace = workspaces[index];
  if (!workspace) return null;
  return currentFilter === workspace.uuid ? "all" : workspace.uuid;
}

export function workspaceReloadKind(view: ViewId) {
  if (view === "duplicates") return "duplicates" as const;
  if (
    view === "child-tabs" ||
    view === "sibling-tabs" ||
    view === "parent-tabs" ||
    view === "last-visited" ||
    view === "unvisited-tabs" ||
    view === "tabs-by-age" ||
    view === "most-visited" ||
    view === "move-to-parent" ||
    view === "domain-tabs" ||
    view === "domains"
  ) {
    return "list" as const;
  }
  return null;
}
