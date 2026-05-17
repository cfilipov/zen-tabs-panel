import type { ExtensionRow } from "../runtime/extension-client";
import type { NavigationHistory } from "../runtime/history-client";
import type { ActionPreview, ActionsSnapshot } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";
import { filterNavigationHistory } from "./navigation-history";

export type ActionsTabIndexClient = {
  getActionsSnapshot(): Promise<ActionsSnapshot>;
};

export type ActionsWorkspaceClient = {
  getWorkspacesWithIcons(): Promise<WorkspaceRow[]>;
};

export type ActionsExtensionClient = {
  listExtensions(): Promise<ExtensionRow[]>;
};

export type ActionsHistoryClient = {
  getRecentlyClosed(): Promise<unknown[]>;
  getNavigationHistory(): Promise<NavigationHistory | null>;
};

export type LoadActionsDeps = {
  tabIndexClient: ActionsTabIndexClient;
  workspaceClient: ActionsWorkspaceClient;
  extensionClient: ActionsExtensionClient;
  historyClient: ActionsHistoryClient;
  getSelectedTabDomIds: () => Promise<string[]>;
};

export type ActionsMenuData = {
  workspaces: WorkspaceRow[];
  workspaceTabCounts: Record<string, number>;
  extensions: ExtensionRow[];
  iconHtmlById: Record<string, string | null>;
  previewsById: Record<string, ActionPreview | null>;
  counts: Record<string, number>;
  disabledIds: Set<string>;
};

function historyPreview(entry: { title?: string; url?: string } | undefined): ActionPreview | null {
  if (!entry) return null;
  return {
    title: entry.title || entry.url || "Untitled",
    url: entry.url || "",
    isHistory: true,
  };
}

function workspaceNavigationIconMap(workspaces: WorkspaceRow[]): Record<string, string | null> {
  const activeIndex = workspaces.findIndex((workspace) => workspace.isActive);
  if (activeIndex < 0 || workspaces.length <= 1) return {};
  const prev = workspaces[(activeIndex - 1 + workspaces.length) % workspaces.length];
  const next = workspaces[(activeIndex + 1) % workspaces.length];
  return {
    "go-to-prev-workspace": prev.svgContent ? `<span class="workspace-icon">${prev.svgContent}</span>` : null,
    "go-to-next-workspace": next.svgContent ? `<span class="workspace-icon">${next.svgContent}</span>` : null,
  };
}

export function emptyActionsMenuData(): ActionsMenuData {
  return {
    workspaces: [],
    workspaceTabCounts: {},
    extensions: [],
    iconHtmlById: {},
    previewsById: {},
    counts: {},
    disabledIds: new Set(),
  };
}

export async function loadActionsMenuData(deps: LoadActionsDeps): Promise<ActionsMenuData> {
  const [
    workspaces,
    snapshot,
    extensions,
    recentlyClosed,
    navHistory,
    selectedDomIds,
  ] = await Promise.all([
    deps.workspaceClient.getWorkspacesWithIcons().catch(() => []),
    deps.tabIndexClient.getActionsSnapshot().catch(() => null),
    deps.extensionClient.listExtensions().catch(() => []),
    deps.historyClient.getRecentlyClosed().catch(() => []),
    deps.historyClient.getNavigationHistory().then(filterNavigationHistory).catch(() => null),
    deps.getSelectedTabDomIds().catch(() => []),
  ]);

  const hasVisibleHistoryCurrent = !!navHistory && navHistory.index >= 0;
  const backPreview = hasVisibleHistoryCurrent && navHistory.index > 0
    ? historyPreview(navHistory.entries[navHistory.index - 1])
    : null;
  const forwardPreview = hasVisibleHistoryCurrent && navHistory.index < navHistory.entries.length - 1
    ? historyPreview(navHistory.entries[navHistory.index + 1])
    : null;
  const previewsById: Record<string, ActionPreview | null> = {
    ...(snapshot?.previews ?? {}),
    "go-back-in-tab": backPreview,
    "go-forward-in-tab": forwardPreview,
  };
  const counts = {
    "child-tabs": snapshot?.childTabCount ?? 0,
    "sibling-tabs": snapshot?.siblingTabCount ?? 0,
    "parent-tabs": snapshot?.parentTabCount ?? 0,
    "unvisited-tabs": snapshot?.unvisitedTabCount ?? 0,
    "domains": snapshot?.domainCount ?? 0,
    "recently-closed": recentlyClosed.length,
    "duplicates": snapshot?.duplicateGroupCount ?? 0,
    "move-to-workspace": selectedDomIds.length > 1 ? selectedDomIds.length : 0,
  };
  const disabledIds = new Set([
    ...(!previewsById["go-to-previous-tab"] ? ["go-to-previous-tab"] : []),
    ...(!previewsById["go-to-parent-tab"] ? ["go-to-parent-tab"] : []),
    ...(!previewsById["go-to-prev-vertical-tab"] ? ["go-to-prev-vertical-tab"] : []),
    ...(!previewsById["go-to-next-vertical-tab"] ? ["go-to-next-vertical-tab"] : []),
    ...(!previewsById["go-back-in-tab"] ? ["go-back-in-tab"] : []),
    ...(!previewsById["go-forward-in-tab"] ? ["go-forward-in-tab"] : []),
    ...(!previewsById["unvisited-newest"] ? ["unvisited-newest"] : []),
    ...(!previewsById["unvisited-oldest"] ? ["unvisited-oldest"] : []),
    ...((snapshot?.childTabCount ?? 0) <= 0 ? ["child-tabs"] : []),
    ...((snapshot?.siblingTabCount ?? 0) <= 0 ? ["sibling-tabs"] : []),
    ...((snapshot?.parentTabCount ?? 0) <= 0 ? ["parent-tabs"] : []),
    ...((snapshot?.unvisitedTabCount ?? 0) <= 0 ? ["unvisited-tabs"] : []),
    ...((snapshot?.domainCount ?? 0) <= 0 ? ["domains"] : []),
    ...((snapshot?.duplicateGroupCount ?? 0) <= 0 ? ["duplicates"] : []),
    ...(recentlyClosed.length <= 0 ? ["recently-closed"] : []),
    ...((navHistory?.entries.length ?? 0) <= 1 ? ["navigation"] : []),
    ...(!snapshot?.currentTabIsPinned ? ["reset-pinned-tab"] : []),
  ]);

  return {
    workspaces,
    workspaceTabCounts: snapshot?.workspaceTabCounts ?? {},
    extensions,
    iconHtmlById: workspaceNavigationIconMap(workspaces),
    previewsById,
    counts,
    disabledIds,
  };
}
