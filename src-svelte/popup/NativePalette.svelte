<script lang="ts">
  import { onMount, tick } from "svelte";
  import PaletteShell from "./components/PaletteShell.svelte";
  import ActionsMenu from "./views/ActionsMenu.svelte";
  import { resolveActionItemActivation, type ActionItemActivation } from "./interaction/action-activation";
  import { nextActionSectionIndex, nextActionsPage } from "./interaction/actions-navigation";
  import { createBridgeDispatchController } from "./interaction/bridge-dispatch";
  import {
    installChordBridgeHandlers,
    type BridgeKeyData,
    type BridgeReply,
    type ForceReadyPayload,
  } from "./chord-bridge";
  import ContainerList from "./views/ContainerList.svelte";
  import DomainList from "./views/DomainList.svelte";
  import DuplicateGroups from "./views/DuplicateGroups.svelte";
  import DuplicatePrompt from "./views/DuplicatePrompt.svelte";
  import FolderList from "./views/FolderList.svelte";
  import PrefixMenu from "./views/PrefixMenu.svelte";
  import NavigationList from "./views/NavigationList.svelte";
  import ProfileList from "./views/ProfileList.svelte";
  import RecentlyClosedList from "./views/RecentlyClosedList.svelte";
  import TabList from "./views/TabList.svelte";
  import TabInfoView from "./views/TabInfoView.svelte";
  import WorkspaceList from "./views/WorkspaceList.svelte";
  import {
    interpretVisibleInput,
    type InteractionCommand,
  } from "./interaction/interpreter";
  import { chordFromKey } from "./interaction/inputs";
  import { DUPLICATE_PROMPT_ACTIONS, type DuplicatePromptAction } from "./interaction/duplicate-prompt-options";
  import { applyInteractionCommand, type InteractionRuntimeHandlers } from "./interaction/runtime";
  import {
    loadWindowForIndex,
    rowInWindow,
    visibleRangeRequest,
  } from "./interaction/list-window";
  import { replayKeyForBadgeIndex, replayKeyForNavigationIndex } from "./interaction/replay-trace";
  import { nextSelectionIndex, type SelectionContext } from "./interaction/selection";
  import {
    keepOnlyTabInfoDuplicate,
    removeRecentlyClosedRow,
    removeTabFromDuplicateGroups,
    removeTabFromRows,
    removeTabInfoDuplicate,
  } from "./interaction/row-state";
  import {
    listViewParams,
    normalizeWorkspaceFilter,
    toggleSortForView,
    toggleWorkspaceFilterValue,
    workspaceFilterByIndex,
    workspaceReloadKind,
  } from "./interaction/sort-filter";
  import {
    resolveSelectionActivation,
    resolveViewActivation,
    type ViewActivation,
    type ViewActivationContext,
  } from "./interaction/view-activation";
  import { commandForViewActivation, type ViewCommand } from "./interaction/view-command";
  import { isWorkspaceFilterView } from "./interaction/view-capabilities";
  import { buildSidebarModel, type SidebarHintId } from "./interaction/sidebar-model";
  import { chromeNavigationMessage } from "./interaction/view-navigation";
  import { createContainerClient, type ContainerRow } from "./runtime/container-client";
  import { createExtensionClient, type ExtensionRow } from "./runtime/extension-client";
  import { createFolderClient, type FolderRow } from "./runtime/folder-client";
  import { createHistoryClient, type NavigationHistory, type RecentlyClosedRow } from "./runtime/history-client";
  import { fireMessage, sendMessage } from "./runtime/ipc";
  import {
    directionalListItemId,
    measurePaletteNaturalHeight,
    scrollPaletteListIndexIntoView,
    scrollSelectedItemIntoView,
    snapshotKeyEvent,
  } from "./runtime/palette-dom";
  import { createPaletteRevealController } from "./runtime/palette-reveal";
  import { createProfileClient, type ProfileRow } from "./runtime/profile-client";
  import { createTabInfoClient, type HistoryVisit, type TabInfo } from "./runtime/tab-info-client";
  import { createViewLoadController } from "./runtime/view-load-controller";
  import {
    createTabIndexClient,
    type ActionPreview,
    type DomainIndexRow,
    type DuplicateGroupRow,
    type TabIndexRow,
  } from "./runtime/tab-index-client";
  import { createWorkspaceClient, type WorkspaceRow } from "./runtime/workspace-client";
  import { emptyActionsMenuData, loadActionsMenuData, type ActionsMenuData } from "./view-loaders/actions-loader";
  import {
    loadMoveToFolderView,
    loadMoveToWorkspaceView,
    loadNavigationView,
    loadOpenInContainerView,
    loadProfilesView,
    loadRecentlyClosedView,
  } from "./view-loaders/basic-loaders";
  import { loadDuplicateGroupsView } from "./view-loaders/duplicates-loader";
  import { loadDuplicatePromptView } from "./view-loaders/duplicate-prompt-loader";
  import { loadNativeListWindow, type NativeListRow } from "./view-loaders/list-loader";
  import { loadTabInfoView } from "./view-loaders/tab-info-loader";
  import { runViewLoad } from "./view-loaders/view-load-runner";
  import {
    isNativeListView,
    isNativePrefixView,
    isNativeTabView,
    resolveViewTitle,
    resolveViewOpenPlan,
    type NativeListView,
    type ViewLoaderId,
  } from "./view-loaders/view-registry";
  import {
    actionItemsForPage,
    actionNodesForSections,
    appendWorkspaceSwitchItems,
    applyActionMetadata,
    applyActionSelection,
    buildActionsMenuModel,
    prefixChildNodesForView,
    prefixItemsForView,
    type ActionMenuItem,
  } from "./views/actions-model";
  import type { ViewId } from "../shared/types";
  import { createNativePaletteState } from "./store/native-palette-state.svelte";

  type NativeRow = NativeListRow;
  type SidebarHint = {
    id: string;
    label: string;
    badge: string;
    hidden?: boolean;
    onclick: () => void;
  };

  const client = createTabIndexClient();
  const containerClient = createContainerClient();
  const extensionClient = createExtensionClient();
  const folderClient = createFolderClient();
  const historyClient = createHistoryClient();
  const profileClient = createProfileClient();
  const tabInfoClient = createTabInfoClient();
  const workspaceClient = createWorkspaceClient();
  const actionSections = buildActionsMenuModel();

  const paletteStore = createNativePaletteState();
  const palette = paletteStore.state;
  let pageAlive = true;
  let terminalCommandDispatched = false;
  const revealController = createPaletteRevealController({
    sendReveal: (inst) => fireMessage({ type: "reveal-palette", inst }),
  });
  const bridgeDispatch = createBridgeDispatchController({
    dispatchKey: handleKeyInput,
    armRevealTimer: revealController.arm,
    clearRevealTimer: revealController.clear,
  });

  const headerHidden = $derived(palette.currentView === "actions");
  const pageCount = $derived(Math.max(1, Math.max(...actionSections.map((section) => section.page))));
  const viewLoad = createViewLoadController<ViewId>({
    getCurrentView: () => palette.currentView,
    setCurrentView: (view) => { palette.currentView = view; },
    setLoading: (value) => { palette.loading = value; },
    setError: (value) => { palette.error = value; },
  });
  const renderedActionSections = $derived(
    applyActionMetadata(
      appendWorkspaceSwitchItems(actionSections, palette.actionsWorkspaces, palette.actionWorkspaceTabCounts),
      palette.actionCounts,
      palette.disabledActionIds,
      palette.actionIconHtmlById,
      palette.actionPreviewsById,
    ),
  );
  const visibleActionItems = $derived(actionItemsForPage(renderedActionSections, palette.currentPage));
  const allActionItems = $derived(renderedActionSections.flatMap((section) => section.items));
  const allActionNodes = $derived(actionNodesForSections(renderedActionSections));
  const prefixItems = $derived(isNativePrefixView(palette.currentView) ? prefixItemsForView(palette.currentView) : []);
  const prefixNodes = $derived(isNativePrefixView(palette.currentView) ? prefixChildNodesForView(palette.currentView) : []);
  const title = $derived(resolveViewTitle(palette.currentView, {
    currentDomain: palette.currentDomain,
    actionLabel: allActionItems.find((item) => item.view === palette.currentView)?.label ?? null,
  }));
  const selectedActionId = $derived(palette.currentView === "actions" ? visibleActionItems[palette.selectedIndex]?.id ?? null : null);
  const actionSectionsForRender = $derived(applyActionSelection(renderedActionSections, selectedActionId));
  const selectedPrefixId = $derived(isNativePrefixView(palette.currentView) ? prefixItems[palette.selectedIndex]?.id ?? null : null);
  const prefixItemsForRender = $derived(prefixItems.map((item) => ({
    ...item,
    selected: selectedPrefixId !== null && item.id === selectedPrefixId,
  })));
  const selectedRow = $derived(isNativeListView(palette.currentView) ? rowForIndex(palette.selectedIndex) : null);
  const selectedTabRow = $derived(isTabRow(selectedRow) ? selectedRow : null);
  const selectedDomainRow = $derived(isDomainRow(selectedRow) ? selectedRow : null);
  const tabRows = $derived(palette.rows.filter(isTabRow));
  const domainRows = $derived(palette.rows.filter(isDomainRow));
  const selectedRowDomId = $derived(selectedTabRow?.domId ?? null);
  const selectedDomain = $derived(selectedDomainRow?.domain ?? null);
  const navigationEntries = $derived(palette.navigationHistory?.entries ?? []);
  const activeWorkspaceId = $derived(palette.sidebarWorkspaces.find((workspace) => workspace.isActive)?.uuid ?? null);
  const sidebarModel = $derived(buildSidebarModel({
    view: palette.currentView,
    selectedIndex: palette.selectedIndex,
    domainsSortAlpha: palette.domainsSortAlpha,
    tabsByAgeNewestFirst: palette.tabsByAgeNewestFirst,
  }));
  const sidebarHintsOnly = $derived(sidebarModel.hintsOnly);
  const sidebarSortLabel = $derived(sidebarModel.sortLabel);
  const sidebarHints = $derived<SidebarHint[]>(sidebarModel.hints.map((hint) => ({
    ...hint,
    onclick: sidebarHintAction(hint.id),
  })));
  const sidebarHidden = $derived(sidebarModel.hidden);
  const interactionRuntime: InteractionRuntimeHandlers = {
    runAction: async (actionId) => {
      const item = [...allActionItems, ...prefixItems].find((candidate) => candidate.id === actionId);
      if (item) await performActionItem(item);
    },
    openView: (view) => openNativeView(view, undefined, true),
    runDuplicatePromptAction,
    navigateHistoryDelta: (delta) => {
      const current = palette.navigationHistory?.index ?? -1;
      const target = current + delta;
      if (target >= 0 && target < navigationEntries.length) {
        navigateToHistoryIndex(target);
      }
    },
    cancel: () => fireMessage({ type: "hide-palette" }),
    back: goBack,
    moveSelection,
    moveSelectionDirectional,
    activateSelection: activateSelected,
    activateRow,
    cyclePage,
    jumpSection,
    closeSelection: closeSelectedTabRow,
    closeAll: closeAllRowsInView,
    restoreSelectionKeepOpen: restoreSelectedRecentlyClosed,
    drillSelection: drillSelectedParent,
    toggleSort: toggleCurrentSort,
    toggleWorkspaceFilter,
    filterWorkspaceIndex: filterWorkspaceByIndex,
    switchWorkspaceIndex: switchWorkspaceByIndex,
    openExtensionIndex: openExtensionByIndex,
  };

  function applyActionsMenuData(data: ActionsMenuData) {
    palette.actionsWorkspaces = data.workspaces;
    palette.actionWorkspaceTabCounts = data.workspaceTabCounts;
    palette.actionExtensions = data.extensions;
    palette.actionIconHtmlById = data.iconHtmlById;
    palette.actionPreviewsById = data.previewsById;
    palette.actionCounts = data.counts;
    palette.disabledActionIds = data.disabledIds;
  }

  function sidebarHintAction(id: SidebarHintId) {
    if (id === "close") return closeSelectedTabRow;
    if (id === "close-all") return closeAllRowsInView;
    if (id === "restore") return restoreSelectedRecentlyClosed;
    return drillSelectedParent;
  }

  function isDomainRow(row: NativeRow | null): row is DomainIndexRow {
    return row?.kind === "domain";
  }

  function isTabRow(row: NativeRow | null): row is TabIndexRow {
    return !!row && row.kind !== "domain";
  }

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
      const workspaces = await workspaceClient.getWorkspacesWithIcons();
      if (generation !== viewLoad.generation || !isWorkspaceFilterView(palette.currentView)) return;
      palette.sidebarWorkspaces = workspaces;
      if (palette.workspaceFilter !== "all" && !workspaces.some((workspace) => workspace.uuid === palette.workspaceFilter)) {
        palette.workspaceFilter = "all";
      }
    } catch {
      if (generation === viewLoad.generation) palette.sidebarWorkspaces = [];
    }
  }

  async function loadActionsData() {
    try {
      const data = await loadActionsMenuData({
        tabIndexClient: client,
        workspaceClient,
        extensionClient,
        historyClient,
        getSelectedTabDomIds: () => sendMessage<string[]>({ type: "get-selected-tab-dom-ids" }),
      });
      applyActionsMenuData(data);
    } catch {
      applyActionsMenuData(emptyActionsMenuData());
    }
  }

  async function loadListView(view: NativeListView, nextOffset = 0, limit = 80, resetSelection = true, params = viewParams(view)) {
    await runViewLoad({
      controller: viewLoad,
      view,
      loading: resetSelection,
      afterBegin: (load) => {
        palette.offset = nextOffset;
        void refreshSidebarWorkspaces(load.id);
      },
      load: async () => {
        return loadNativeListWindow<NativeRow>(client, {
          view,
          offset: nextOffset,
          limit,
          params,
        });
      },
      commit: (win) => {
        palette.rows = win.rows;
        palette.total = win.total;
        if (resetSelection) {
          palette.selectedIndex = -1;
        }
      },
      fail: (message) => {
        palette.rows = [];
        palette.total = 0;
        palette.selectedIndex = -1;
        palette.error = message;
      },
    });
  }

  async function loadNavigation() {
    await runViewLoad({
      controller: viewLoad,
      view: "navigation",
      load: () => loadNavigationView(historyClient),
      commit: (result) => {
        palette.navigationHistory = result.history;
        palette.selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        palette.navigationHistory = null;
        palette.selectedIndex = -1;
        palette.error = message;
      },
    });
  }

  async function loadRecentlyClosed() {
    await runViewLoad({
      controller: viewLoad,
      view: "recently-closed",
      load: () => loadRecentlyClosedView(historyClient),
      commit: (result) => {
        palette.recentlyClosedRows = result.rows;
        palette.selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        palette.recentlyClosedRows = [];
        palette.selectedIndex = -1;
        palette.error = message;
      },
    });
  }

  async function loadMoveToWorkspace() {
    await runViewLoad({
      controller: viewLoad,
      view: "move-to-workspace",
      load: () => loadMoveToWorkspaceView(workspaceClient),
      commit: (result) => {
        palette.workspaceRows = result.rows;
        palette.selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        palette.workspaceRows = [];
        palette.selectedIndex = -1;
        palette.error = message;
      },
    });
  }

  async function loadOpenInContainer() {
    await runViewLoad({
      controller: viewLoad,
      view: "open-in-container",
      load: () => loadOpenInContainerView(containerClient),
      commit: (result) => {
        palette.containerRows = result.rows;
        palette.selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        palette.containerRows = [];
        palette.selectedIndex = -1;
        palette.error = message;
      },
    });
  }

  async function loadMoveToFolder() {
    await runViewLoad({
      controller: viewLoad,
      view: "move-to-folder",
      load: () => loadMoveToFolderView(folderClient, workspaceClient),
      commit: (result) => {
        palette.folderRows = result.folders;
        palette.folderWorkspaces = result.workspaces;
        palette.selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        palette.folderRows = [];
        palette.folderWorkspaces = [];
        palette.selectedIndex = -1;
        palette.error = message;
      },
    });
  }

  async function loadProfiles() {
    await runViewLoad({
      controller: viewLoad,
      view: "profiles",
      load: () => loadProfilesView(profileClient),
      commit: (result) => {
        palette.profileRows = result.rows;
        palette.selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        palette.profileRows = [];
        palette.selectedIndex = -1;
        palette.error = message;
      },
    });
  }

  async function loadDuplicates() {
    await runViewLoad({
      controller: viewLoad,
      view: "duplicates",
      load: () => loadDuplicateGroupsView(client, workspaceClient, palette.workspaceFilter),
      commit: (result) => {
        palette.sidebarWorkspaces = result.workspaces;
        palette.duplicateWorkspaces = result.workspaces;
        palette.workspaceFilter = result.workspaceFilter;
        palette.duplicateGroups = result.groups;
        palette.selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        palette.duplicateGroups = [];
        palette.duplicateWorkspaces = [];
        palette.selectedIndex = -1;
        palette.error = message;
      },
    });
  }

  async function loadTabInfo() {
    await runViewLoad({
      controller: viewLoad,
      view: "tab-info",
      load: () => loadTabInfoView(client, tabInfoClient, workspaceClient),
      commit: (result) => {
        palette.tabInfo = result.info;
        palette.tabInfoVisits = result.visits;
        palette.tabInfoDuplicates = result.duplicates;
        palette.tabInfoWorkspaces = result.workspaces;
        palette.selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        palette.tabInfo = null;
        palette.tabInfoVisits = [];
        palette.tabInfoDuplicates = [];
        palette.tabInfoWorkspaces = [];
        palette.selectedIndex = -1;
        palette.error = message;
      },
    });
  }

  async function loadDuplicatePrompt(params = new URLSearchParams(location.search)) {
    await runViewLoad({
      controller: viewLoad,
      view: "duplicate-prompt",
      loading: false,
      load: async () => loadDuplicatePromptView(params),
      commit: (result) => {
        palette.duplicatePromptUrl = result.url;
        palette.duplicatePromptDomId = result.domId;
        palette.selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        palette.duplicatePromptUrl = "";
        palette.duplicatePromptDomId = null;
        palette.selectedIndex = -1;
        palette.error = message;
      },
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
    "duplicate-prompt": (params) => loadDuplicatePrompt(params instanceof URLSearchParams ? params : undefined),
  };

  function notifyChromeView(view: ViewId, params?: URLSearchParams | Record<string, unknown>) {
    fireMessage(chromeNavigationMessage(view, params));
  }

  async function finishOpenView(view: ViewId) {
    await requestPanelResize(view);
    return true;
  }

  async function openNativeView(view: ViewId, params?: URLSearchParams | Record<string, unknown>, notifyChrome = false) {
    terminalCommandDispatched = false;
    if (notifyChrome) notifyChromeView(view, params);
    const plan = resolveViewOpenPlan(view, params);

    if (plan.kind === "actions") {
      await goBack();
      return true;
    } else if (plan.kind === "list") {
      palette.currentDomain = plan.domain;
      await loadListView(plan.view, 0, 80, true, { ...plan.params, ...viewParams(plan.view) });
    } else if (plan.kind === "prefix") {
      palette.currentView = plan.view;
      palette.selectedIndex = -1;
      palette.error = null;
    } else if (plan.kind === "loader") {
      await registeredViewLoaders[plan.loader](params);
    } else {
      return false;
    }

    return finishOpenView(view);
  }

  async function performActionItemActivation(activation: ActionItemActivation) {
    if (activation.kind === "fire-action") {
      terminalCommandDispatched = true;
      revealController.clear();
      fireMessage({ type: activation.actionId });
      return;
    }
    if (activation.kind === "switch-workspace") {
      terminalCommandDispatched = true;
      switchWorkspace(activation.workspaceId);
      return;
    }
    if (activation.kind === "open-view") {
      await openNativeView(activation.view, undefined, true);
      return;
    }
  }

  async function performActionItem(item: ActionMenuItem) {
    await performActionItemActivation(resolveActionItemActivation(item));
  }

  async function activateAction(item: ActionMenuItem) {
    const activation = resolveActionItemActivation(item);
    if (activation.kind === "none") return;
    if (activation.kind === "switch-workspace") {
      switchWorkspace(activation.workspaceId);
      return;
    }

    const actionNodes = isNativePrefixView(palette.currentView) ? prefixNodes : allActionNodes;
    const command = interpretVisibleInput(
      { kind: "mouse", targetId: item.id },
      { view: palette.currentView },
      actionNodes,
    );
    if (command.kind !== "none") {
      await runCommand(command);
    }
  }

  function activateTab(row: { domId: string }) {
    terminalCommandDispatched = true;
    revealController.clear();
    fireMessage({ type: "activate-tab", domId: row.domId });
  }

  function traceReplayKey(key: string | null | undefined) {
    if (!key) return;
    fireMessage({ type: "trace-replay-key", key });
  }

  function traceReplayInput(input: BridgeKeyData) {
    traceReplayKey(chordFromKey({ kind: "key", ...input }));
  }

  function traceReplayForListIndex(index: number) {
    traceReplayKey(replayKeyForBadgeIndex(index));
  }

  function traceReplayForSelection() {
    if (palette.currentView === "actions" || isNativePrefixView(palette.currentView)) return;
    if (palette.currentView === "navigation") {
      traceReplayKey(replayKeyForNavigationIndex(palette.navigationHistory, palette.selectedIndex));
      return;
    }
    traceReplayForListIndex(palette.selectedIndex);
  }

  function traceReplayForRowIndex<T>(rows: readonly T[], row: T) {
    const index = rows.indexOf(row);
    traceReplayForListIndex(index);
  }

  async function activateDomain(row: DomainIndexRow) {
    palette.currentDomain = row.domain;
    await openNativeView("domain-tabs", { domain: row.domain }, true);
  }

  function navigateToHistoryIndex(index: number) {
    const historyIndex = palette.navigationHistory?.entries[index]?.historyIndex ?? index;
    terminalCommandDispatched = true;
    revealController.clear();
    fireMessage({ type: "navigate-to-history-index", index: historyIndex });
  }

  function navigateToHistoryIndexWithTrace(index: number) {
    traceReplayKey(replayKeyForNavigationIndex(palette.navigationHistory, index));
    navigateToHistoryIndex(index);
  }

  function restoreClosedTab(row: RecentlyClosedRow, keepOpen = false) {
    if (!keepOpen) terminalCommandDispatched = true;
    if (!keepOpen) revealController.clear();
    fireMessage({
      type: keepOpen ? "restore-closed-tab-keep-open" : "restore-closed-tab",
      sessionId: row.sessionId,
    });
  }

  function restoreClosedTabWithTrace(row: RecentlyClosedRow) {
    traceReplayForRowIndex(palette.recentlyClosedRows, row);
    restoreClosedTab(row);
  }

  function moveToWorkspace(row: WorkspaceRow) {
    terminalCommandDispatched = true;
    revealController.clear();
    fireMessage({ type: "move-selected-tabs-to-workspace", workspaceId: row.uuid });
  }

  function moveToWorkspaceWithTrace(row: WorkspaceRow) {
    traceReplayForRowIndex(palette.workspaceRows, row);
    moveToWorkspace(row);
  }

  function reopenInContainer(row: ContainerRow) {
    terminalCommandDispatched = true;
    revealController.clear();
    fireMessage({ type: "reopen-in-container", userContextId: row.userContextId });
  }

  function reopenInContainerWithTrace(row: ContainerRow) {
    traceReplayForRowIndex(palette.containerRows, row);
    reopenInContainer(row);
  }

  function moveToFolder(row: FolderRow) {
    terminalCommandDispatched = true;
    revealController.clear();
    fireMessage({ type: "move-tab-to-folder", folderId: row.id });
  }

  function moveToFolderWithTrace(row: FolderRow) {
    traceReplayForRowIndex(palette.folderRows, row);
    moveToFolder(row);
  }

  function launchProfile(row: ProfileRow) {
    if (row.isCurrent) return;
    terminalCommandDispatched = true;
    revealController.clear();
    fireMessage({ type: "launch-profile", name: row.name });
  }

  function launchProfileWithTrace(row: ProfileRow) {
    traceReplayForRowIndex(palette.profileRows, row);
    launchProfile(row);
  }

  function switchWorkspace(workspaceId: string) {
    terminalCommandDispatched = true;
    revealController.clear();
    fireMessage({ type: "switch-workspace", workspaceId });
  }

  function openExtensionPopup(extension: ExtensionRow) {
    terminalCommandDispatched = true;
    revealController.clear();
    fireMessage({ type: "open-extension-popup", extensionId: extension.id });
  }

  function activateTabRowWithTrace(row: TabIndexRow) {
    traceReplayForListIndex(row.index);
    activateTab(row);
  }

  async function activateDomainWithTrace(row: DomainIndexRow) {
    traceReplayForRowIndex(domainRows, row);
    await activateDomain(row);
  }

  function switchWorkspaceByIndex(index: number) {
    const workspace = palette.actionsWorkspaces[index];
    if (!workspace || workspace.isActive) return;
    switchWorkspace(workspace.uuid);
  }

  function openExtensionByIndex(index: number) {
    const extension = palette.actionExtensions[index];
    if (!extension) return;
    openExtensionPopup(extension);
  }

  function closeDuplicateTab(row: TabIndexRow) {
    fireMessage({ type: "close-tab", domId: row.domId });
    palette.duplicateGroups = removeTabFromDuplicateGroups(palette.duplicateGroups, row.domId);
  }

  function closeSelectedTabRow() {
    const row = selectedTabRow;
    if (!row) return;
    fireMessage({ type: "close-tab", domId: row.domId });
    const result = removeTabFromRows({ rows: palette.rows, total: palette.total, selectedIndex: palette.selectedIndex, domId: row.domId });
    palette.rows = result.rows;
    palette.total = result.total;
    palette.selectedIndex = result.selectedIndex;
  }

  async function closeAllRowsInView() {
    if (!isNativeTabView(palette.currentView)) return;
    const domIds = palette.rows.filter(isTabRow).map((row) => row.domId);
    if (!domIds.length) return;
    await Promise.all(domIds.map((domId) => sendMessage({ type: "close-tab", domId }).catch(() => {})));
    loadListView(palette.currentView, 0, 80, true, viewParams(palette.currentView));
  }

  function restoreSelectedRecentlyClosed() {
    if (palette.currentView !== "recently-closed") return;
    const row = palette.recentlyClosedRows[palette.selectedIndex];
    if (!row) return;
    restoreClosedTab(row, true);
    const result = removeRecentlyClosedRow({ rows: palette.recentlyClosedRows, selectedIndex: palette.selectedIndex, sessionId: row.sessionId });
    palette.recentlyClosedRows = result.rows;
    palette.selectedIndex = result.selectedIndex;
  }

  async function drillSelectedParent() {
    if (palette.currentView !== "parent-tabs" || !selectedTabRow) return;
    await openNativeView("child-tabs", { ...viewParams("child-tabs"), parentDomId: selectedTabRow.domId }, true);
  }

  async function toggleCurrentSort() {
    const result = toggleSortForView(palette.currentView, { domainsSortAlpha: palette.domainsSortAlpha, tabsByAgeNewestFirst: palette.tabsByAgeNewestFirst });
    palette.domainsSortAlpha = result.domainsSortAlpha;
    palette.tabsByAgeNewestFirst = result.tabsByAgeNewestFirst;
    if (result.reloadView) await loadListView(result.reloadView, 0, 80, true, viewParams(result.reloadView));
  }

  async function reloadWorkspaceFilteredView() {
    const reloadKind = workspaceReloadKind(palette.currentView);
    if (reloadKind === "list" && isNativeListView(palette.currentView)) {
      await loadListView(palette.currentView);
      return;
    }
    if (reloadKind === "duplicates") {
      await loadDuplicates();
    }
  }

  async function setWorkspaceFilter(nextFilter: string) {
    palette.workspaceFilter = normalizeWorkspaceFilter(nextFilter);
    await reloadWorkspaceFilteredView();
  }

  async function toggleWorkspaceFilter() {
    await setWorkspaceFilter(toggleWorkspaceFilterValue(palette.workspaceFilter, activeWorkspaceId));
  }

  async function filterWorkspaceByIndex(index: number) {
    const nextFilter = workspaceFilterByIndex(palette.workspaceFilter, palette.sidebarWorkspaces, index);
    if (nextFilter) await setWorkspaceFilter(nextFilter);
  }

  function closeTabInfoDuplicate(row: TabIndexRow) {
    fireMessage({ type: "close-tab", domId: row.domId });
    palette.tabInfoDuplicates = removeTabInfoDuplicate(palette.tabInfoDuplicates, row.domId);
  }

  function closeOtherTabInfoDuplicates() {
    if (!palette.tabInfo) return;
    const selfDomId = palette.tabInfo.domId;
    for (const duplicate of palette.tabInfoDuplicates) {
      if (duplicate.domId !== selfDomId) {
        fireMessage({ type: "close-tab", domId: duplicate.domId });
      }
    }
    palette.tabInfoDuplicates = keepOnlyTabInfoDuplicate(palette.tabInfoDuplicates, selfDomId);
  }

  function runDuplicatePromptAction(action: DuplicatePromptAction) {
    terminalCommandDispatched = true;
    revealController.clear();
    fireMessage({ type: action });
  }


  function previewTab(row: TabIndexRow) {
    fireMessage({ type: "preview-tab", domId: row.domId });
  }

  function previewTabLike(row: { domId: string }) {
    fireMessage({ type: "preview-tab", domId: row.domId });
  }

  function clearPreview() {
    fireMessage({ type: "clear-preview" });
  }

  function resetToActions() {
    clearPreview();
    paletteStore.clearLoadedViewData();
    palette.currentView = "actions";
    palette.currentPage = 1;
  }

  async function goBack() {
    resetToActions();
    await loadActionsData();
    await requestPanelResize("actions");
  }

  function moveSelection(delta: 1 | -1) {
    palette.selectedIndex = nextSelectionIndex(selectionContext(), delta);
    if (palette.currentView !== "actions" && !isNativePrefixView(palette.currentView)) {
      ensureListIndexLoaded(palette.selectedIndex);
    }
    scrollCurrentSelectionIntoView();
  }

  function moveSelectionDirectional(delta: 1 | -1) {
    const targetId = directionalListItemId(delta, {
      currentPage: palette.currentView === "actions" ? palette.currentPage : undefined,
    });
    if (!targetId) return;

    const items = palette.currentView === "actions"
      ? visibleActionItems
      : isNativePrefixView(palette.currentView)
      ? prefixItems
      : [];
    const index = items.findIndex((item) => item.id === targetId);
    if (index < 0) return;

    palette.selectedIndex = index;
    scrollCurrentSelectionIntoView();
  }

  function selectionContext(): SelectionContext {
    return {
      view: palette.currentView,
      selectedIndex: palette.selectedIndex,
      actionCount: visibleActionItems.length,
      prefixCount: prefixItems.length,
      navigationCount: navigationEntries.length,
      recentlyClosedCount: palette.recentlyClosedRows.length,
      workspaceCount: palette.workspaceRows.length,
      containerCount: palette.containerRows.length,
      folderCount: palette.folderRows.length,
      profileRows: palette.profileRows,
      duplicatePromptCount: DUPLICATE_PROMPT_ACTIONS.length,
      rowCount: isNativeListView(palette.currentView) ? palette.total : palette.rows.length,
      isPrefixView: isNativePrefixView(palette.currentView),
    };
  }

  function cyclePage(delta: 1 | -1) {
    setActionsPage(palette.currentPage + delta);
  }

  function setActionsPage(targetPage: number) {
    if (palette.currentView !== "actions" || pageCount <= 1) return;
    const nextPage = nextActionsPage(palette.currentPage, targetPage, pageCount);
    if (nextPage === null) return;
    palette.currentPage = nextPage;
    palette.selectedIndex = -1;
    clearPreview();
  }

  function jumpSection(delta: 1 | -1) {
    if (palette.currentView !== "actions") return;
    const nextIndex = nextActionSectionIndex({
      sections: renderedActionSections,
      currentPage: palette.currentPage,
      visibleItemCount: visibleActionItems.length,
      selectedIndex: palette.selectedIndex,
      delta,
    });
    if (nextIndex !== null) {
      palette.selectedIndex = nextIndex;
      scrollCurrentSelectionIntoView();
    }
  }

  async function activateSelected() {
    traceReplayForSelection();

    if (palette.currentView === "actions") {
      const item = visibleActionItems[palette.selectedIndex];
      if (item) await activateAction(item);
      return;
    }

    if (isNativePrefixView(palette.currentView)) {
      const item = prefixItems[palette.selectedIndex];
      if (item) await activateAction(item);
      return;
    }

    await applyViewActivation(resolveSelectionActivation(viewActivationContext()));
  }

  async function activateRow(index: number) {
    traceReplayForListIndex(index);
    await applyViewActivation(resolveViewActivation(viewActivationContext(), index, "shortcut"));
  }

  function viewActivationContext(): ViewActivationContext {
    return {
      view: palette.currentView,
      selectedIndex: palette.selectedIndex,
      offset: palette.offset,
      rows: palette.rows,
      navigationHistory: palette.navigationHistory,
      recentlyClosedRows: palette.recentlyClosedRows,
      workspaceRows: palette.workspaceRows,
      containerRows: palette.containerRows,
      folderRows: palette.folderRows,
      profileRows: palette.profileRows,
    };
  }

  async function applyViewActivation(activation: ViewActivation) {
    await applyViewCommand(commandForViewActivation(activation));
  }

  async function applyViewCommand(command: ViewCommand) {
    if (command.kind === "message") {
      if (command.clearReveal) {
        terminalCommandDispatched = true;
        revealController.clear();
      }
      fireMessage(command.message);
    } else if (command.kind === "open-domain") {
      await activateDomain({ kind: "domain", domain: command.domain, count: 0 });
    } else if (command.kind === "duplicate-prompt-action") {
      runDuplicatePromptAction(command.action);
    }
  }

  function rowForIndex(index: number) {
    return rowInWindow(palette.rows, palette.offset, index);
  }

  function ensureListIndexLoaded(index: number) {
    if (!isNativeListView(palette.currentView)) return;
    const request = loadWindowForIndex({ index, offset: palette.offset, rowCount: palette.rows.length });
    if (request) {
      void loadListView(palette.currentView, request.offset, request.limit, false)
        .then(scrollCurrentSelectionIntoView);
    }
  }

  function scrollListIndexIntoView(index: number) {
    scrollPaletteListIndexIntoView(index);
  }

  function scrollCurrentSelectionIntoView() {
    void tick().then(() => {
      if (!pageAlive) return;
      const scroll = () => {
        if (!pageAlive) return;
        if (palette.currentView !== "actions" && !isNativePrefixView(palette.currentView)) {
          scrollListIndexIntoView(palette.selectedIndex);
        }
        scrollSelectedItemIntoView();
      };
      scroll();
      requestAnimationFrame(() => {
        scroll();
        setTimeout(scroll, 50);
      });
    });
  }

  function loadVisibleRange(nextOffset: number, limit: number) {
    if (!isNativeListView(palette.currentView)) return;
    const request = visibleRangeRequest(nextOffset, limit);
    loadListView(palette.currentView, request.offset, request.limit, false, viewParams(palette.currentView));
  }

  function tabSubtitle(row: TabIndexRow) {
    return palette.currentView === "most-visited" ? `${row.focusCount ?? 0} focuses` : null;
  }

  async function runCommand(command: InteractionCommand) {
    await applyInteractionCommand(command, interactionRuntime);
  }

  async function handleKeyInput(input: BridgeKeyData) {
    if (terminalCommandDispatched) {
      return false;
    }
    const actionNodes = palette.currentView === "actions" ? allActionNodes : isNativePrefixView(palette.currentView) ? prefixNodes : [];
    const command = interpretVisibleInput({ kind: "key", ...input }, { view: palette.currentView }, actionNodes);
    if (command.kind === "none") {
      return false;
    }

    if (command.kind === "action" || command.kind === "open-view" || command.kind === "enter-prefix") {
      traceReplayInput(input);
    }
    await runCommand(command);
    return true;
  }

  function handleBridgeKey(input: BridgeKeyData) {
    bridgeDispatch.queueOrHold(input);
  }

  function handleKeydown(event: KeyboardEvent) {
    const input = snapshotKeyEvent(event);
    const result = bridgeDispatch.visibleKeydownInput(input);
    if (result.preventDefault) event.preventDefault();
    if (result.stopPropagation) event.stopPropagation();
  }

  async function requestPanelResize(view: ViewId = palette.currentView) {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!pageAlive) return;
    await sendMessage({ type: "resize-panel", view, height: measurePaletteNaturalHeight() }).catch(() => {});
  }

  async function signalPopupReady() {
    if (!pageAlive) return null;
    try {
      return await sendMessage<BridgeReply>(revealController.popupReadyMessage());
    } catch {
      return null;
    }
  }

  async function drainBridge(reply: BridgeReply | null, generation?: number) {
    if (reply?.stale) return;
    if (reply?.view && reply.view !== palette.currentView) {
      await openNativeView(reply.view as ViewId);
      await requestPanelResize(reply.view as ViewId);
    }

    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    await bridgeDispatch.drainReply(reply, generation);
  }

  async function initializeBridge(initialViewReady: Promise<unknown>) {
    revealController.configureFromSearch(location.search);

    await initialViewReady.catch(() => {});
    await requestPanelResize(palette.currentView);
    const reply = await signalPopupReady();
    await drainBridge(reply);
  }

  async function handleWarmRearm(data: { inst?: number; view?: ViewId; params?: Record<string, unknown> }) {
    const generation = bridgeDispatch.resetForWarmRearm();
    revealController.updateInst(data.inst);
    clearPreview();

    const view = data.view || "actions";
    await openNativeView(view, data.params || {});
    if (!bridgeDispatch.isCurrentWarmGeneration(generation)) return;
    await requestPanelResize(view);
    if (!bridgeDispatch.isCurrentWarmGeneration(generation)) return;
    const reply = await signalPopupReady();
    await drainBridge(reply, generation);
  }

  function handleForceReady(data: ForceReadyPayload) {
    bridgeDispatch.forceReady(data);
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const initialView = params.get("view") as ViewId | null;
    const initialViewReady = initialView ? openNativeView(initialView, params) : loadActionsData();

    window.addEventListener("keydown", handleKeydown);
    pageAlive = true;
    revealController.markAlive();
    window.addEventListener("pagehide", handlePageHide);
    const uninstallBridge = installChordBridgeHandlers({
      onDeliverKey: handleBridgeKey,
      onWarmRearm: (data) => void handleWarmRearm(data),
      onForceReady: handleForceReady,
      onCancelReveal: revealController.clear,
      onGoToActions: goToActions,
    });
    void initializeBridge(initialViewReady);
    return () => {
      revealController.clear();
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("pagehide", handlePageHide);
      uninstallBridge();
    };
  });

  function handlePageHide() {
    pageAlive = false;
    revealController.markDead();
  }

  function goToActions() {
    if (palette.currentView !== "actions") {
      void openNativeView("actions").then(() => requestPanelResize("actions"));
    }
  }

  $effect(() => {
    if (selectedTabRow) {
      previewTab(selectedTabRow);
    } else if (palette.currentView === "actions") {
      clearPreview();
    }
  });
</script>

<PaletteShell
  {headerHidden}
  {title}
  onback={palette.currentView === "actions" ? undefined : goBack}
  {sidebarHidden}
  {sidebarHints}
  {sidebarHintsOnly}
  {sidebarSortLabel}
  sidebarWorkspaces={palette.sidebarWorkspaces}
  workspaceFilter={palette.workspaceFilter}
  {activeWorkspaceId}
  pageIndicatorHidden={palette.currentView !== "actions" || pageCount <= 1}
  {pageCount}
  currentPage={palette.currentPage}
  onSidebarSort={toggleCurrentSort}
  onWorkspaceFilter={setWorkspaceFilter}
  onPage={setActionsPage}
>
  {#if palette.error}
    <div class="empty-state">{palette.error}</div>
  {:else if palette.currentView === "actions"}
    <ActionsMenu
      sections={actionSectionsForRender}
      currentPage={palette.currentPage}
      extensions={palette.actionExtensions}
      workspaces={palette.actionsWorkspaces}
      onactivate={activateAction}
      onextension={openExtensionPopup}
      onpreview={(domId) => previewTabLike({ domId })}
      onclearpreview={clearPreview}
    />
  {:else if isNativePrefixView(palette.currentView)}
    <PrefixMenu view={palette.currentView} items={prefixItemsForRender} onactivate={activateAction} />
  {:else if palette.loading}
    <div class="empty-state">Loading...</div>
  {:else if palette.currentView === "navigation"}
    <NavigationList
      history={palette.navigationHistory}
      selectedIndex={palette.selectedIndex}
      onactivate={navigateToHistoryIndexWithTrace}
    />
  {:else if palette.currentView === "recently-closed"}
    <RecentlyClosedList
      rows={palette.recentlyClosedRows}
      selectedIndex={palette.selectedIndex}
      onactivate={restoreClosedTabWithTrace}
      onrestore={(row) => restoreClosedTab(row, true)}
    />
  {:else if palette.currentView === "move-to-workspace"}
    <WorkspaceList
      rows={palette.workspaceRows}
      selectedIndex={palette.selectedIndex}
      onactivate={moveToWorkspaceWithTrace}
    />
  {:else if palette.currentView === "open-in-container"}
    <ContainerList
      rows={palette.containerRows}
      selectedIndex={palette.selectedIndex}
      onactivate={reopenInContainerWithTrace}
    />
  {:else if palette.currentView === "move-to-folder"}
    <FolderList
      rows={palette.folderRows}
      workspaces={palette.folderWorkspaces}
      selectedIndex={palette.selectedIndex}
      onactivate={moveToFolderWithTrace}
    />
  {:else if palette.currentView === "profiles"}
    <ProfileList
      rows={palette.profileRows}
      selectedIndex={palette.selectedIndex}
      onactivate={launchProfileWithTrace}
    />
  {:else if palette.currentView === "duplicates"}
    <DuplicateGroups
      groups={palette.duplicateGroups}
      workspaces={palette.duplicateWorkspaces}
      onactivate={activateTab}
      onclose={closeDuplicateTab}
      onpreview={previewTab}
      onclearpreview={clearPreview}
    />
  {:else if palette.currentView === "tab-info"}
    <TabInfoView
      info={palette.tabInfo}
      visits={palette.tabInfoVisits}
      duplicates={palette.tabInfoDuplicates}
      workspaces={palette.tabInfoWorkspaces}
      onactivate={activateTab}
      onclose={closeTabInfoDuplicate}
      oncloseothers={closeOtherTabInfoDuplicates}
      onpreview={previewTabLike}
      onclearpreview={clearPreview}
    />
  {:else if palette.currentView === "duplicate-prompt"}
    <DuplicatePrompt
      url={palette.duplicatePromptUrl}
      existingDomId={palette.duplicatePromptDomId}
      selectedIndex={palette.selectedIndex}
      onactivate={runDuplicatePromptAction}
      onpreview={(domId) => previewTabLike({ domId })}
      onclearpreview={clearPreview}
    />
  {:else if isNativeTabView(palette.currentView)}
    <TabList
      rows={tabRows}
      total={palette.total}
      offset={palette.offset}
      selectedDomId={selectedRowDomId}
      onactivate={activateTabRowWithTrace}
      onpreview={previewTab}
      onclearpreview={clearPreview}
      onrange={loadVisibleRange}
      subtitle={tabSubtitle}
    />
  {:else if palette.currentView === "domains"}
    <DomainList
      rows={domainRows}
      total={palette.total}
      offset={palette.offset}
      {selectedDomain}
      onactivate={activateDomainWithTrace}
      onrange={loadVisibleRange}
    />
  {/if}
</PaletteShell>
