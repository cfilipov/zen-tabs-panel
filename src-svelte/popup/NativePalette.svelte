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
    DUPLICATE_PROMPT_ACTIONS,
    interpretVisibleInput,
    type DuplicatePromptAction,
    type InteractionCommand,
  } from "./interaction/interpreter";
  import { applyInteractionCommand, type InteractionRuntimeHandlers } from "./interaction/runtime";
  import {
    loadWindowForIndex,
    rowInWindow,
    scrollTopForIndex,
    visibleRangeRequest,
  } from "./interaction/list-window";
  import { naturalPanelHeight } from "./interaction/panel-measure";
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
  import { isWorkspaceFilterView } from "./interaction/view-capabilities";
  import { buildSidebarModel, type SidebarHintId } from "./interaction/sidebar-model";
  import { createContainerClient, type ContainerRow } from "./runtime/container-client";
  import { createExtensionClient, type ExtensionRow } from "./runtime/extension-client";
  import { createFolderClient, type FolderRow } from "./runtime/folder-client";
  import { createHistoryClient, type NavigationHistory, type RecentlyClosedRow } from "./runtime/history-client";
  import { fireMessage, sendMessage } from "./runtime/ipc";
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
    buildActionsMenuModel,
    prefixChildNodesForView,
    prefixItemsForView,
    type ActionMenuItem,
  } from "./views/actions-model";
  import type { ViewId } from "../shared/types";

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

  let currentView = $state<ViewId>("actions");
  let rows = $state<NativeRow[]>([]);
  let total = $state(0);
  let offset = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let currentPage = $state(1);
  let selectedIndex = $state(-1);
  let currentDomain = $state<string | null>(null);
  let navigationHistory = $state<NavigationHistory | null>(null);
  let recentlyClosedRows = $state<RecentlyClosedRow[]>([]);
  let workspaceRows = $state<WorkspaceRow[]>([]);
  let containerRows = $state<ContainerRow[]>([]);
  let folderRows = $state<FolderRow[]>([]);
  let folderWorkspaces = $state<WorkspaceRow[]>([]);
  let profileRows = $state<ProfileRow[]>([]);
  let duplicateGroups = $state<DuplicateGroupRow[]>([]);
  let duplicateWorkspaces = $state<WorkspaceRow[]>([]);
  let tabInfo = $state<TabInfo | null>(null);
  let tabInfoVisits = $state<HistoryVisit[]>([]);
  let tabInfoDuplicates = $state<TabIndexRow[]>([]);
  let tabInfoWorkspaces = $state<WorkspaceRow[]>([]);
  let duplicatePromptUrl = $state("");
  let duplicatePromptDomId = $state<string | null>(null);
  let domainsSortAlpha = $state(false);
  let tabsByAgeNewestFirst = $state(false);
  let sidebarWorkspaces = $state<WorkspaceRow[]>([]);
  let workspaceFilter = $state("all");
  let actionsWorkspaces = $state<WorkspaceRow[]>([]);
  let actionWorkspaceTabCounts = $state<Record<string, number>>({});
  let actionCounts = $state<Record<string, number>>({});
  let actionPreviewsById = $state<Record<string, ActionPreview | null>>({});
  let disabledActionIds = $state<Set<string>>(new Set());
  let actionIconHtmlById = $state<Record<string, string | null>>({});
  let actionExtensions = $state<ExtensionRow[]>([]);
  let popupInst: number | null = null;
  let popupChordDelay = 350;
  let popupRevealTimer: ReturnType<typeof setTimeout> | null = null;
  let pageAlive = true;
  const bridgeDispatch = createBridgeDispatchController({
    dispatchKey: handleKeyInput,
    armRevealTimer: armPopupRevealTimer,
    clearRevealTimer: clearPopupRevealTimer,
  });

  const headerHidden = $derived(currentView === "actions");
  const pageCount = $derived(Math.max(1, Math.max(...actionSections.map((section) => section.page))));
  const viewLoad = createViewLoadController<ViewId>({
    getCurrentView: () => currentView,
    setCurrentView: (view) => { currentView = view; },
    setLoading: (value) => { loading = value; },
    setError: (value) => { error = value; },
  });
  const renderedActionSections = $derived(
    applyActionMetadata(
      appendWorkspaceSwitchItems(actionSections, actionsWorkspaces, actionWorkspaceTabCounts),
      actionCounts,
      disabledActionIds,
      actionIconHtmlById,
      actionPreviewsById,
    ),
  );
  const visibleActionItems = $derived(actionItemsForPage(renderedActionSections, currentPage));
  const allActionItems = $derived(renderedActionSections.flatMap((section) => section.items));
  const allActionNodes = $derived(actionNodesForSections(renderedActionSections));
  const prefixItems = $derived(isNativePrefixView(currentView) ? prefixItemsForView(currentView) : []);
  const prefixNodes = $derived(isNativePrefixView(currentView) ? prefixChildNodesForView(currentView) : []);
  const title = $derived(resolveViewTitle(currentView, {
    currentDomain,
    actionLabel: allActionItems.find((item) => item.view === currentView)?.label ?? null,
  }));
  const selectedActionId = $derived(currentView === "actions" ? visibleActionItems[selectedIndex]?.id ?? null : null);
  const selectedPrefixId = $derived(isNativePrefixView(currentView) ? prefixItems[selectedIndex]?.id ?? null : null);
  const selectedRow = $derived(isNativeListView(currentView) ? rowForIndex(selectedIndex) : null);
  const selectedTabRow = $derived(isTabRow(selectedRow) ? selectedRow : null);
  const selectedDomainRow = $derived(isDomainRow(selectedRow) ? selectedRow : null);
  const tabRows = $derived(rows.filter(isTabRow));
  const domainRows = $derived(rows.filter(isDomainRow));
  const selectedRowDomId = $derived(selectedTabRow?.domId ?? null);
  const selectedDomain = $derived(selectedDomainRow?.domain ?? null);
  const navigationEntries = $derived(navigationHistory?.entries ?? []);
  const activeWorkspaceId = $derived(sidebarWorkspaces.find((workspace) => workspace.isActive)?.uuid ?? null);
  const sidebarModel = $derived(buildSidebarModel({
    view: currentView,
    selectedIndex,
    domainsSortAlpha,
    tabsByAgeNewestFirst,
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
      const current = navigationHistory?.index ?? -1;
      const target = current + delta;
      if (target >= 0 && target < navigationEntries.length) {
        navigateToHistoryIndex(target);
      }
    },
    cancel: () => fireMessage({ type: "hide-palette" }),
    back: goBack,
    moveSelection,
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
    actionsWorkspaces = data.workspaces;
    actionWorkspaceTabCounts = data.workspaceTabCounts;
    actionExtensions = data.extensions;
    actionIconHtmlById = data.iconHtmlById;
    actionPreviewsById = data.previewsById;
    actionCounts = data.counts;
    disabledActionIds = data.disabledIds;
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
      workspaceFilter,
      currentDomain,
      domainsSortAlpha,
      tabsByAgeNewestFirst,
    });
  }

  async function refreshSidebarWorkspaces(generation = viewLoad.generation) {
    if (!isWorkspaceFilterView(currentView)) return;
    try {
      const workspaces = await workspaceClient.getWorkspacesWithIcons();
      if (generation !== viewLoad.generation || !isWorkspaceFilterView(currentView)) return;
      sidebarWorkspaces = workspaces;
      if (workspaceFilter !== "all" && !workspaces.some((workspace) => workspace.uuid === workspaceFilter)) {
        workspaceFilter = "all";
      }
    } catch {
      if (generation === viewLoad.generation) sidebarWorkspaces = [];
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
        offset = nextOffset;
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
        rows = win.rows;
        total = win.total;
        if (resetSelection) {
          selectedIndex = -1;
        }
      },
      fail: (message) => {
        rows = [];
        total = 0;
        selectedIndex = -1;
        error = message;
      },
    });
  }

  async function loadNavigation() {
    await runViewLoad({
      controller: viewLoad,
      view: "navigation",
      load: () => loadNavigationView(historyClient),
      commit: (result) => {
        navigationHistory = result.history;
        selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        navigationHistory = null;
        selectedIndex = -1;
        error = message;
      },
    });
  }

  async function loadRecentlyClosed() {
    await runViewLoad({
      controller: viewLoad,
      view: "recently-closed",
      load: () => loadRecentlyClosedView(historyClient),
      commit: (result) => {
        recentlyClosedRows = result.rows;
        selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        recentlyClosedRows = [];
        selectedIndex = -1;
        error = message;
      },
    });
  }

  async function loadMoveToWorkspace() {
    await runViewLoad({
      controller: viewLoad,
      view: "move-to-workspace",
      load: () => loadMoveToWorkspaceView(workspaceClient),
      commit: (result) => {
        workspaceRows = result.rows;
        selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        workspaceRows = [];
        selectedIndex = -1;
        error = message;
      },
    });
  }

  async function loadOpenInContainer() {
    await runViewLoad({
      controller: viewLoad,
      view: "open-in-container",
      load: () => loadOpenInContainerView(containerClient),
      commit: (result) => {
        containerRows = result.rows;
        selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        containerRows = [];
        selectedIndex = -1;
        error = message;
      },
    });
  }

  async function loadMoveToFolder() {
    await runViewLoad({
      controller: viewLoad,
      view: "move-to-folder",
      load: () => loadMoveToFolderView(folderClient, workspaceClient),
      commit: (result) => {
        folderRows = result.folders;
        folderWorkspaces = result.workspaces;
        selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        folderRows = [];
        folderWorkspaces = [];
        selectedIndex = -1;
        error = message;
      },
    });
  }

  async function loadProfiles() {
    await runViewLoad({
      controller: viewLoad,
      view: "profiles",
      load: () => loadProfilesView(profileClient),
      commit: (result) => {
        profileRows = result.rows;
        selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        profileRows = [];
        selectedIndex = -1;
        error = message;
      },
    });
  }

  async function loadDuplicates() {
    await runViewLoad({
      controller: viewLoad,
      view: "duplicates",
      load: () => loadDuplicateGroupsView(tabIndexClient, workspaceClient, workspaceFilter),
      commit: (result) => {
        sidebarWorkspaces = result.workspaces;
        duplicateWorkspaces = result.workspaces;
        workspaceFilter = result.workspaceFilter;
        duplicateGroups = result.groups;
        selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        duplicateGroups = [];
        duplicateWorkspaces = [];
        selectedIndex = -1;
        error = message;
      },
    });
  }

  async function loadTabInfo() {
    await runViewLoad({
      controller: viewLoad,
      view: "tab-info",
      load: () => loadTabInfoView(tabIndexClient, tabInfoClient, workspaceClient),
      commit: (result) => {
        tabInfo = result.info;
        tabInfoVisits = result.visits;
        tabInfoDuplicates = result.duplicates;
        tabInfoWorkspaces = result.workspaces;
        selectedIndex = result.selectedIndex;
      },
      fail: (message) => {
        tabInfo = null;
        tabInfoVisits = [];
        tabInfoDuplicates = [];
        tabInfoWorkspaces = [];
        selectedIndex = -1;
        error = message;
      },
    });
  }

  function loadDuplicatePrompt(params = new URLSearchParams(location.search)) {
    viewLoad.begin("duplicate-prompt", { loading: false });
    duplicatePromptUrl = params.get("url") || "";
    duplicatePromptDomId = params.get("domId");
    selectedIndex = -1;
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

  function encodedParams(params?: URLSearchParams | Record<string, unknown>) {
    if (!params) return undefined;
    if (params instanceof URLSearchParams) {
      return JSON.stringify(Object.fromEntries(params.entries()));
    }
    return JSON.stringify(params);
  }

  function notifyChromeView(view: ViewId, params?: URLSearchParams | Record<string, unknown>) {
    if (view === "actions") {
      fireMessage({ type: "navigate-back" });
      return;
    }
    fireMessage({ type: "navigate-view", view, params: encodedParams(params) });
  }

  async function finishOpenView(view: ViewId) {
    await requestPanelResize(view);
    return true;
  }

  async function openNativeView(view: ViewId, params?: URLSearchParams | Record<string, unknown>, notifyChrome = false) {
    if (notifyChrome) notifyChromeView(view, params);
    const plan = resolveViewOpenPlan(view, params);

    if (plan.kind === "actions") {
      await goBack();
      return true;
    } else if (plan.kind === "list") {
      currentDomain = plan.domain;
      await loadListView(plan.view, 0, 80, true, { ...plan.params, ...viewParams(plan.view) });
    } else if (plan.kind === "prefix") {
      currentView = plan.view;
      selectedIndex = -1;
      error = null;
    } else if (plan.kind === "loader") {
      await registeredViewLoaders[plan.loader](params);
    } else {
      return false;
    }

    return finishOpenView(view);
  }

  async function performActionItemActivation(activation: ActionItemActivation) {
    if (activation.kind === "fire-action") {
      clearPopupRevealTimer();
      fireMessage({ type: activation.actionId });
      return;
    }
    if (activation.kind === "switch-workspace") {
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

    const actionNodes = isNativePrefixView(currentView) ? prefixNodes : allActionNodes;
    const command = interpretVisibleInput(
      { kind: "mouse", targetId: item.id },
      { view: currentView },
      actionNodes,
    );
    if (command.kind !== "none") {
      await runCommand(command);
    }
  }

  function activateTab(row: TabIndexRow) {
    clearPopupRevealTimer();
    fireMessage({ type: "activate-tab", domId: row.domId });
  }

  function activateTabLike(row: { domId: string }) {
    clearPopupRevealTimer();
    fireMessage({ type: "activate-tab", domId: row.domId });
  }

  async function activateDomain(row: DomainIndexRow) {
    currentDomain = row.domain;
    await openNativeView("domain-tabs", { domain: row.domain }, true);
  }

  function navigateToHistoryIndex(index: number) {
    clearPopupRevealTimer();
    fireMessage({ type: "navigate-to-history-index", index });
  }

  function restoreClosedTab(row: RecentlyClosedRow, keepOpen = false) {
    if (!keepOpen) clearPopupRevealTimer();
    fireMessage({
      type: keepOpen ? "restore-closed-tab-keep-open" : "restore-closed-tab",
      sessionId: row.sessionId,
    });
  }

  function moveToWorkspace(row: WorkspaceRow) {
    clearPopupRevealTimer();
    fireMessage({ type: "move-selected-tabs-to-workspace", workspaceId: row.uuid });
  }

  function reopenInContainer(row: ContainerRow) {
    clearPopupRevealTimer();
    fireMessage({ type: "reopen-in-container", userContextId: row.userContextId });
  }

  function moveToFolder(row: FolderRow) {
    clearPopupRevealTimer();
    fireMessage({ type: "move-tab-to-folder", folderId: row.id });
  }

  function launchProfile(row: ProfileRow) {
    if (row.isCurrent) return;
    clearPopupRevealTimer();
    fireMessage({ type: "launch-profile", name: row.name });
  }

  function switchWorkspace(workspaceId: string) {
    clearPopupRevealTimer();
    fireMessage({ type: "switch-workspace", workspaceId });
  }

  function openExtensionPopup(extension: ExtensionRow) {
    clearPopupRevealTimer();
    fireMessage({ type: "open-extension-popup", extensionId: extension.id });
  }

  function switchWorkspaceByIndex(index: number) {
    const workspace = actionsWorkspaces[index];
    if (!workspace || workspace.isActive) return;
    switchWorkspace(workspace.uuid);
  }

  function openExtensionByIndex(index: number) {
    const extension = actionExtensions[index];
    if (!extension) return;
    openExtensionPopup(extension);
  }

  function closeDuplicateTab(row: TabIndexRow) {
    fireMessage({ type: "close-tab", domId: row.domId });
    duplicateGroups = removeTabFromDuplicateGroups(duplicateGroups, row.domId);
  }

  function closeSelectedTabRow() {
    const row = selectedTabRow;
    if (!row) return;
    fireMessage({ type: "close-tab", domId: row.domId });
    const result = removeTabFromRows({ rows, total, selectedIndex, domId: row.domId });
    rows = result.rows;
    total = result.total;
    selectedIndex = result.selectedIndex;
  }

  async function closeAllRowsInView() {
    if (!isNativeTabView(currentView)) return;
    const domIds = rows.filter(isTabRow).map((row) => row.domId);
    if (!domIds.length) return;
    await Promise.all(domIds.map((domId) => sendMessage({ type: "close-tab", domId }).catch(() => {})));
    loadListView(currentView, 0, 80, true, viewParams(currentView));
  }

  function restoreSelectedRecentlyClosed() {
    if (currentView !== "recently-closed") return;
    const row = recentlyClosedRows[selectedIndex];
    if (!row) return;
    restoreClosedTab(row, true);
    const result = removeRecentlyClosedRow({ rows: recentlyClosedRows, selectedIndex, sessionId: row.sessionId });
    recentlyClosedRows = result.rows;
    selectedIndex = result.selectedIndex;
  }

  async function drillSelectedParent() {
    if (currentView !== "parent-tabs" || !selectedTabRow) return;
    await openNativeView("child-tabs", { ...viewParams("child-tabs"), parentDomId: selectedTabRow.domId }, true);
  }

  async function toggleCurrentSort() {
    const result = toggleSortForView(currentView, { domainsSortAlpha, tabsByAgeNewestFirst });
    domainsSortAlpha = result.domainsSortAlpha;
    tabsByAgeNewestFirst = result.tabsByAgeNewestFirst;
    if (result.reloadView) await loadListView(result.reloadView, 0, 80, true, viewParams(result.reloadView));
  }

  async function reloadWorkspaceFilteredView() {
    const reloadKind = workspaceReloadKind(currentView);
    if (reloadKind === "list" && isNativeListView(currentView)) {
      await loadListView(currentView);
      return;
    }
    if (reloadKind === "duplicates") {
      await loadDuplicates();
    }
  }

  async function setWorkspaceFilter(nextFilter: string) {
    workspaceFilter = normalizeWorkspaceFilter(nextFilter);
    await reloadWorkspaceFilteredView();
  }

  async function toggleWorkspaceFilter() {
    await setWorkspaceFilter(toggleWorkspaceFilterValue(workspaceFilter, activeWorkspaceId));
  }

  async function filterWorkspaceByIndex(index: number) {
    const nextFilter = workspaceFilterByIndex(workspaceFilter, sidebarWorkspaces, index);
    if (nextFilter) await setWorkspaceFilter(nextFilter);
  }

  function closeTabInfoDuplicate(row: TabIndexRow) {
    fireMessage({ type: "close-tab", domId: row.domId });
    tabInfoDuplicates = removeTabInfoDuplicate(tabInfoDuplicates, row.domId);
  }

  function closeOtherTabInfoDuplicates() {
    if (!tabInfo) return;
    const selfDomId = tabInfo.domId;
    for (const duplicate of tabInfoDuplicates) {
      if (duplicate.domId !== selfDomId) {
        fireMessage({ type: "close-tab", domId: duplicate.domId });
      }
    }
    tabInfoDuplicates = keepOnlyTabInfoDuplicate(tabInfoDuplicates, selfDomId);
  }

  function runDuplicatePromptAction(action: DuplicatePromptAction) {
    clearPopupRevealTimer();
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
    currentView = "actions";
    rows = [];
    total = 0;
    offset = 0;
    currentDomain = null;
    navigationHistory = null;
    recentlyClosedRows = [];
    workspaceRows = [];
    containerRows = [];
    folderRows = [];
    folderWorkspaces = [];
    profileRows = [];
    duplicateGroups = [];
    duplicateWorkspaces = [];
    tabInfo = null;
    tabInfoVisits = [];
    tabInfoDuplicates = [];
    tabInfoWorkspaces = [];
    duplicatePromptUrl = "";
    duplicatePromptDomId = null;
    sidebarWorkspaces = [];
    currentPage = 1;
    selectedIndex = -1;
    error = null;
  }

  async function goBack() {
    resetToActions();
    await loadActionsData();
    await requestPanelResize("actions");
  }

  function moveSelection(delta: 1 | -1) {
    selectedIndex = nextSelectionIndex(selectionContext(), delta);
    if (currentView !== "actions" && !isNativePrefixView(currentView)) {
      ensureListIndexLoaded(selectedIndex);
      scrollListIndexIntoView(selectedIndex);
    }
  }

  function selectionContext(): SelectionContext {
    return {
      view: currentView,
      selectedIndex,
      actionCount: visibleActionItems.length,
      prefixCount: prefixItems.length,
      navigationCount: navigationEntries.length,
      recentlyClosedCount: recentlyClosedRows.length,
      workspaceCount: workspaceRows.length,
      containerCount: containerRows.length,
      folderCount: folderRows.length,
      profileRows,
      duplicatePromptCount: DUPLICATE_PROMPT_ACTIONS.length,
      rowCount: rows.length,
      isPrefixView: isNativePrefixView(currentView),
    };
  }

  function cyclePage(delta: 1 | -1) {
    setActionsPage(currentPage + delta);
  }

  function setActionsPage(targetPage: number) {
    if (currentView !== "actions" || pageCount <= 1) return;
    const nextPage = nextActionsPage(currentPage, targetPage, pageCount);
    if (nextPage === null) return;
    currentPage = nextPage;
    selectedIndex = -1;
    clearPreview();
  }

  function jumpSection(delta: 1 | -1) {
    if (currentView !== "actions") return;
    const nextIndex = nextActionSectionIndex({
      sections: actionSections,
      currentPage,
      visibleItemCount: visibleActionItems.length,
      selectedIndex,
      delta,
    });
    if (nextIndex !== null) selectedIndex = nextIndex;
  }

  async function activateSelected() {
    if (currentView === "actions") {
      const item = visibleActionItems[selectedIndex];
      if (item) await activateAction(item);
      return;
    }

    if (isNativePrefixView(currentView)) {
      const item = prefixItems[selectedIndex];
      if (item) await activateAction(item);
      return;
    }

    await applyViewActivation(resolveSelectionActivation(viewActivationContext()));
  }

  async function activateRow(index: number) {
    await applyViewActivation(resolveViewActivation(viewActivationContext(), index, "shortcut"));
  }

  function viewActivationContext(): ViewActivationContext {
    return {
      view: currentView,
      selectedIndex,
      offset,
      rows,
      navigationHistory,
      recentlyClosedRows,
      workspaceRows,
      containerRows,
      folderRows,
      profileRows,
    };
  }

  async function applyViewActivation(activation: ViewActivation) {
    if (activation.kind === "activate-tab") activateTab(activation.row);
    else if (activation.kind === "activate-domain") await activateDomain(activation.row);
    else if (activation.kind === "navigate-history-index") navigateToHistoryIndex(activation.index);
    else if (activation.kind === "restore-closed-tab") restoreClosedTab(activation.row);
    else if (activation.kind === "move-to-workspace") moveToWorkspace(activation.row);
    else if (activation.kind === "reopen-in-container") reopenInContainer(activation.row);
    else if (activation.kind === "move-to-folder") moveToFolder(activation.row);
    else if (activation.kind === "launch-profile") launchProfile(activation.row);
    else if (activation.kind === "duplicate-prompt-action") runDuplicatePromptAction(activation.action);
  }

  function rowForIndex(index: number) {
    return rowInWindow(rows, offset, index);
  }

  function ensureListIndexLoaded(index: number) {
    if (!isNativeListView(currentView)) return;
    const request = loadWindowForIndex({ index, offset, rowCount: rows.length });
    if (request) loadListView(currentView, request.offset, request.limit, false);
  }

  function scrollListIndexIntoView(index: number) {
    requestAnimationFrame(() => {
      const list = document.getElementById("list");
      if (!list) return;
      list.scrollTop = scrollTopForIndex({
        index,
        scrollTop: list.scrollTop,
        clientHeight: list.clientHeight,
      });
    });
  }

  function loadVisibleRange(nextOffset: number, limit: number) {
    if (!isNativeListView(currentView)) return;
    const request = visibleRangeRequest(nextOffset, limit);
    loadListView(currentView, request.offset, request.limit, false, viewParams(currentView));
  }

  function tabSubtitle(row: TabIndexRow) {
    return currentView === "most-visited" ? `${row.focusCount ?? 0} focuses` : null;
  }

  async function runCommand(command: InteractionCommand) {
    await applyInteractionCommand(command, interactionRuntime);
  }

  function snapshotKeyEvent(event: KeyboardEvent): BridgeKeyData {
    return {
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
  }

  async function handleKeyInput(input: BridgeKeyData) {
    const actionNodes = currentView === "actions" ? allActionNodes : isNativePrefixView(currentView) ? prefixNodes : [];
    const command = interpretVisibleInput({ kind: "key", ...input }, { view: currentView }, actionNodes);
    if (command.kind === "none") {
      return false;
    }

    await runCommand(command);
    return true;
  }

  function handleBridgeKey(input: BridgeKeyData) {
    bridgeDispatch.queueOrHold(input);
  }

  function handleKeydown(event: KeyboardEvent) {
    const result = bridgeDispatch.keydownInput(snapshotKeyEvent(event));
    if (result.preventDefault) event.preventDefault();
    if (result.stopPropagation) event.stopPropagation();
  }

  function clearPopupRevealTimer() {
    if (popupRevealTimer !== null) {
      clearTimeout(popupRevealTimer);
      popupRevealTimer = null;
    }
  }

  function armPopupRevealTimer() {
    clearPopupRevealTimer();
    popupRevealTimer = setTimeout(() => {
      popupRevealTimer = null;
      if (!pageAlive) return;
      fireMessage({ type: "reveal-palette", inst: popupInst });
    }, popupChordDelay);
  }

  function measureNaturalHeight() {
    const header = document.getElementById("header");
    const list = document.getElementById("list");
    const indicator = document.getElementById("page-indicator");
    const children = list?.children ?? [];
    let listFirstTop: number | null = null;
    let listLastBottom: number | null = null;
    if (children.length > 0) {
      const first = children[0].getBoundingClientRect();
      const last = children[children.length - 1].getBoundingClientRect();
      listFirstTop = first.top;
      listLastBottom = last.bottom;
    }
    const headerVisible = !!header && !header.classList.contains("hidden") && header.children.length > 0;
    const indicatorVisible = !!indicator && !indicator.classList.contains("hidden");
    return naturalPanelHeight({
      listFirstTop,
      listLastBottom,
      headerVisible,
      headerHeight: headerVisible ? header.getBoundingClientRect().height : 0,
      indicatorVisible,
      indicatorHeight: indicatorVisible ? indicator.getBoundingClientRect().height : 0,
    });
  }

  async function requestPanelResize(view: ViewId = currentView) {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!pageAlive) return;
    await sendMessage({ type: "resize-panel", view, height: measureNaturalHeight() }).catch(() => {});
  }

  async function signalPopupReady() {
    if (!pageAlive) return null;
    try {
      return await sendMessage<BridgeReply>({ type: "popup-ready", inst: popupInst });
    } catch {
      return null;
    }
  }

  async function drainBridge(reply: BridgeReply | null, generation?: number) {
    if (reply?.stale) return;
    if (reply?.view && reply.view !== currentView) {
      await openNativeView(reply.view as ViewId);
      await requestPanelResize(reply.view as ViewId);
    }

    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    await bridgeDispatch.drainReply(reply, generation);
  }

  async function initializeBridge(initialViewReady: Promise<unknown>) {
    const params = new URLSearchParams(location.search);
    const inst = Number.parseInt(params.get("inst") || "", 10);
    popupInst = Number.isFinite(inst) ? inst : null;
    const delay = Number.parseInt(params.get("delay") || "", 10);
    if (Number.isFinite(delay) && delay >= 0) popupChordDelay = delay;

    await initialViewReady.catch(() => {});
    await requestPanelResize(currentView);
    const reply = await signalPopupReady();
    await drainBridge(reply);
  }

  async function handleWarmRearm(data: { inst?: number; view?: ViewId; params?: Record<string, unknown> }) {
    const generation = bridgeDispatch.resetForWarmRearm();
    if (typeof data.inst === "number") popupInst = data.inst;
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
    window.addEventListener("pagehide", handlePageHide);
    const uninstallBridge = installChordBridgeHandlers({
      onDeliverKey: handleBridgeKey,
      onWarmRearm: (data) => void handleWarmRearm(data),
      onForceReady: handleForceReady,
      onCancelReveal: clearPopupRevealTimer,
      onGoToActions: goToActions,
    });
    void initializeBridge(initialViewReady);
    return () => {
      clearPopupRevealTimer();
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("pagehide", handlePageHide);
      uninstallBridge();
    };
  });

  function handlePageHide() {
    pageAlive = false;
    clearPopupRevealTimer();
  }

  function goToActions() {
    if (currentView !== "actions") {
      void openNativeView("actions").then(() => requestPanelResize("actions"));
    }
  }

  $effect(() => {
    if (selectedTabRow) {
      previewTab(selectedTabRow);
    } else if (currentView === "actions") {
      clearPreview();
    }
  });
</script>

<PaletteShell
  {headerHidden}
  {title}
  onback={currentView === "actions" ? undefined : goBack}
  {sidebarHidden}
  {sidebarHints}
  {sidebarHintsOnly}
  {sidebarSortLabel}
  {sidebarWorkspaces}
  {workspaceFilter}
  {activeWorkspaceId}
  pageIndicatorHidden={currentView !== "actions" || pageCount <= 1}
  {pageCount}
  {currentPage}
  onSidebarSort={toggleCurrentSort}
  onWorkspaceFilter={setWorkspaceFilter}
  onPage={setActionsPage}
>
  {#if error}
    <div class="empty-state">{error}</div>
  {:else if currentView === "actions"}
    <ActionsMenu
      sections={renderedActionSections}
      {currentPage}
      selectedId={selectedActionId}
      extensions={actionExtensions}
      workspaces={actionsWorkspaces}
      onactivate={activateAction}
      onextension={openExtensionPopup}
      onpreview={(domId) => previewTabLike({ domId })}
      onclearpreview={clearPreview}
    />
  {:else if isNativePrefixView(currentView)}
    <PrefixMenu view={currentView} items={prefixItems} selectedId={selectedPrefixId} onactivate={activateAction} />
  {:else if loading}
    <div class="empty-state">Loading...</div>
  {:else if currentView === "navigation"}
    <NavigationList
      history={navigationHistory}
      {selectedIndex}
      onactivate={navigateToHistoryIndex}
    />
  {:else if currentView === "recently-closed"}
    <RecentlyClosedList
      rows={recentlyClosedRows}
      {selectedIndex}
      onactivate={(row) => restoreClosedTab(row)}
      onrestore={(row) => restoreClosedTab(row, true)}
    />
  {:else if currentView === "move-to-workspace"}
    <WorkspaceList
      rows={workspaceRows}
      {selectedIndex}
      onactivate={moveToWorkspace}
    />
  {:else if currentView === "open-in-container"}
    <ContainerList
      rows={containerRows}
      {selectedIndex}
      onactivate={reopenInContainer}
    />
  {:else if currentView === "move-to-folder"}
    <FolderList
      rows={folderRows}
      workspaces={folderWorkspaces}
      {selectedIndex}
      onactivate={moveToFolder}
    />
  {:else if currentView === "profiles"}
    <ProfileList
      rows={profileRows}
      {selectedIndex}
      onactivate={launchProfile}
    />
  {:else if currentView === "duplicates"}
    <DuplicateGroups
      groups={duplicateGroups}
      workspaces={duplicateWorkspaces}
      onactivate={activateTab}
      onclose={closeDuplicateTab}
      onpreview={previewTab}
      onclearpreview={clearPreview}
    />
  {:else if currentView === "tab-info"}
    <TabInfoView
      info={tabInfo}
      visits={tabInfoVisits}
      duplicates={tabInfoDuplicates}
      workspaces={tabInfoWorkspaces}
      onactivate={activateTabLike}
      onclose={closeTabInfoDuplicate}
      oncloseothers={closeOtherTabInfoDuplicates}
      onpreview={previewTabLike}
      onclearpreview={clearPreview}
    />
  {:else if currentView === "duplicate-prompt"}
    <DuplicatePrompt
      url={duplicatePromptUrl}
      existingDomId={duplicatePromptDomId}
      {selectedIndex}
      onactivate={runDuplicatePromptAction}
      onpreview={(domId) => previewTabLike({ domId })}
      onclearpreview={clearPreview}
    />
  {:else if isNativeTabView(currentView)}
    <TabList
      rows={tabRows}
      {total}
      {offset}
      selectedDomId={selectedRowDomId}
      onactivate={activateTab}
      onpreview={previewTab}
      onclearpreview={clearPreview}
      onrange={loadVisibleRange}
      subtitle={tabSubtitle}
    />
  {:else if currentView === "domains"}
    <DomainList
      rows={domainRows}
      {total}
      {offset}
      {selectedDomain}
      onactivate={activateDomain}
      onrange={loadVisibleRange}
    />
  {/if}
</PaletteShell>
