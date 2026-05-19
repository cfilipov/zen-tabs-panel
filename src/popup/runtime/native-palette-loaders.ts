import type { ViewId } from "../../shared/types";
import type { ContainerRow } from "./container-client";
import type { ExtensionRow } from "./extension-client";
import type { FolderRow } from "./folder-client";
import type { NavigationHistory, RecentlyClosedRow } from "./history-client";
import type { ProfileRow } from "./profile-client";
import type { HistoryVisit, TabInfo } from "./tab-info-client";
import type { DomainIndexRow, TabIndexRow } from "./tab-index-client";
import type { WorkspaceRow } from "./workspace-client";
import type { ViewLoadController } from "./view-load-controller";
import { isWorkspaceFilterView } from "../interaction/view-capabilities";
import type { NativePaletteState, createNativePaletteState } from "../store/native-palette-state.svelte";
import { listViewParams } from "../interaction/sort-filter";
import { loadActionsMenuData, emptyActionsMenuData } from "../view-loaders/actions-loader";
import {
  loadMoveToFolderView,
  loadMoveToWorkspaceView,
  loadNavigationView,
  loadOpenInContainerView,
  loadProfilesView,
  loadRecentlyClosedView,
} from "../view-loaders/basic-loaders";
import { loadDuplicateGroupsView } from "../view-loaders/duplicates-loader";
import { loadDuplicatePromptView } from "../view-loaders/duplicate-prompt-loader";
import { loadNativeListWindow, type NativeListRow, type TabIndexClient } from "../view-loaders/list-loader";
import { loadTabInfoView } from "../view-loaders/tab-info-loader";
import { runViewLoad } from "../view-loaders/view-load-runner";
import type { NativeListView, ViewLoaderId } from "../view-loaders/view-registry";

export type NativePaletteLoaderDeps = {
  palette: NativePaletteState;
  paletteStore: ReturnType<typeof createNativePaletteState>;
  viewLoad: ViewLoadController<ViewId>;
  tabIndexClient: TabIndexClient;
  workspaceClient: { getWorkspacesWithIcons(): Promise<WorkspaceRow[]> };
  extensionClient: { listExtensions(): Promise<ExtensionRow[]> };
  historyClient: {
    getNavigationHistory(): Promise<NavigationHistory | null>;
    getRecentlyClosed(): Promise<RecentlyClosedRow[]>;
  };
  containerClient: { getContainers(): Promise<ContainerRow[]> };
  folderClient: { getFolders(): Promise<FolderRow[]> };
  profileClient: { getProfiles(): Promise<ProfileRow[]> };
  tabInfoClient: {
    getTabInfo(domId: string): Promise<TabInfo | null>;
    getHistoryVisits(url: string): Promise<HistoryVisit[]>;
  };
  getSelectedTabDomIds: () => Promise<string[]>;
};

export function createNativePaletteLoaders(deps: NativePaletteLoaderDeps) {
  const { palette, paletteStore, viewLoad } = deps;

  function viewParams(view: NativeListView) {
    return listViewParams(view, {
      workspaceFilter: palette.workspaceFilter,
      currentDomain: palette.currentDomain,
      domainsSortAlpha: palette.domainsSortAlpha,
      tabsByAgeNewestFirst: palette.tabsByAgeNewestFirst,
    });
  }

  async function refreshSidebarWorkspaces(generation = viewLoad.generation) {
    if (!isWorkspaceFilterView(palette.currentView)) return;
    try {
      const workspaces = await deps.workspaceClient.getWorkspacesWithIcons();
      if (generation !== viewLoad.generation || !isWorkspaceFilterView(palette.currentView)) return;
      paletteStore.commitSidebarWorkspaces(workspaces);
    } catch {
      if (generation === viewLoad.generation) paletteStore.clearSidebarWorkspaces();
    }
  }

  async function loadActionsData() {
    try {
      const data = await loadActionsMenuData({
        tabIndexClient: deps.tabIndexClient,
        workspaceClient: deps.workspaceClient,
        extensionClient: deps.extensionClient,
        historyClient: deps.historyClient,
        getSelectedTabDomIds: deps.getSelectedTabDomIds,
      });
      paletteStore.applyActionsMenuData(data);
    } catch {
      paletteStore.applyActionsMenuData(emptyActionsMenuData());
    }
  }

  async function loadListView(
    view: NativeListView,
    nextOffset = 0,
    limit = 80,
    resetSelection = true,
    params = viewParams(view),
  ) {
    await runViewLoad({
      controller: viewLoad,
      view,
      loading: resetSelection,
      afterBegin: (load) => {
        paletteStore.beginListWindowLoad(nextOffset);
        void refreshSidebarWorkspaces(load.id);
      },
      load: async () => loadNativeListWindow<DomainIndexRow | TabIndexRow>(deps.tabIndexClient, {
        view,
        offset: nextOffset,
        limit,
        params,
      }),
      commit: (win) => paletteStore.commitListWindow(win, resetSelection),
      fail: paletteStore.failListWindow,
    });
  }

  async function loadNavigation() {
    await runViewLoad({
      controller: viewLoad,
      view: "navigation",
      load: () => loadNavigationView(deps.historyClient),
      commit: paletteStore.commitNavigation,
      fail: paletteStore.failNavigation,
    });
  }

  async function loadRecentlyClosed() {
    await runViewLoad({
      controller: viewLoad,
      view: "recently-closed",
      load: () => loadRecentlyClosedView(deps.historyClient),
      commit: paletteStore.commitRecentlyClosed,
      fail: paletteStore.failRecentlyClosed,
    });
  }

  async function loadMoveToWorkspace() {
    await runViewLoad({
      controller: viewLoad,
      view: "move-to-workspace",
      load: () => loadMoveToWorkspaceView(deps.workspaceClient),
      commit: paletteStore.commitMoveToWorkspace,
      fail: paletteStore.failMoveToWorkspace,
    });
  }

  async function loadOpenInContainer() {
    await runViewLoad({
      controller: viewLoad,
      view: "open-in-container",
      load: () => loadOpenInContainerView(deps.containerClient),
      commit: paletteStore.commitOpenInContainer,
      fail: paletteStore.failOpenInContainer,
    });
  }

  async function loadMoveToFolder() {
    await runViewLoad({
      controller: viewLoad,
      view: "move-to-folder",
      load: () => loadMoveToFolderView(deps.folderClient, deps.workspaceClient),
      commit: paletteStore.commitMoveToFolder,
      fail: paletteStore.failMoveToFolder,
    });
  }

  async function loadProfiles() {
    await runViewLoad({
      controller: viewLoad,
      view: "profiles",
      load: () => loadProfilesView(deps.profileClient),
      commit: paletteStore.commitProfiles,
      fail: paletteStore.failProfiles,
    });
  }

  async function loadDuplicates() {
    await runViewLoad({
      controller: viewLoad,
      view: "duplicates",
      load: () => loadDuplicateGroupsView(deps.tabIndexClient, deps.workspaceClient, palette.workspaceFilter),
      commit: paletteStore.commitDuplicates,
      fail: paletteStore.failDuplicates,
    });
  }

  async function loadTabInfo() {
    await runViewLoad({
      controller: viewLoad,
      view: "tab-info",
      load: () => loadTabInfoView(deps.tabIndexClient, deps.tabInfoClient, deps.workspaceClient),
      commit: paletteStore.commitTabInfo,
      fail: paletteStore.failTabInfo,
    });
  }

  async function loadDuplicatePrompt(params: URLSearchParams | Record<string, unknown> = new URLSearchParams(location.search)) {
    await runViewLoad({
      controller: viewLoad,
      view: "duplicate-prompt",
      loading: false,
      load: async () => loadDuplicatePromptView(params),
      commit: paletteStore.commitDuplicatePrompt,
      fail: paletteStore.failDuplicatePrompt,
    });
  }

  const registeredViewLoaders: Record<
    ViewLoaderId,
    (params?: URLSearchParams | Record<string, unknown>) => Promise<void> | void
  > = {
    navigation: loadNavigation,
    "recently-closed": loadRecentlyClosed,
    "move-to-workspace": loadMoveToWorkspace,
    "open-in-container": loadOpenInContainer,
    "move-to-folder": loadMoveToFolder,
    profiles: loadProfiles,
    duplicates: loadDuplicates,
    "tab-info": loadTabInfo,
    "duplicate-prompt": loadDuplicatePrompt,
  };

  return {
    viewParams,
    loadActionsData,
    loadListView,
    loadDuplicates,
    loadRegisteredView: (loader: ViewLoaderId, params?: URLSearchParams | Record<string, unknown>) =>
      registeredViewLoaders[loader](params),
  };
}
