<script lang="ts">
  import { onMount, tick } from "svelte";
  import PaletteShell from "./components/PaletteShell.svelte";
  import ActionsMenu from "./views/ActionsMenu.svelte";
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
    resolveSelectionActivation,
    resolveViewActivation,
    type ViewActivation,
    type ViewActivationContext,
  } from "./interaction/view-activation";
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
    type TabIndexView,
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
  import { loadTabInfoView } from "./view-loaders/tab-info-loader";
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

  type NativeTabView = Extract<
    ViewId,
    | "child-tabs"
    | "sibling-tabs"
    | "parent-tabs"
    | "last-visited"
    | "unvisited-tabs"
    | "tabs-by-age"
    | "most-visited"
    | "domain-tabs"
  >;
  type NativeDomainView = Extract<ViewId, "domains">;
  type NativeListView = NativeTabView | NativeDomainView;
  type NativeRow = TabIndexRow | DomainIndexRow;
  type SidebarHint = {
    id: string;
    label: string;
    badge: string;
    hidden?: boolean;
    onclick: () => void;
  };
  type NativeDuplicateView = Extract<ViewId, "duplicates">;
  type NativeTabInfoView = Extract<ViewId, "tab-info">;
  type NativeDuplicatePromptView = Extract<ViewId, "duplicate-prompt">;
  type NativePrefixView = Extract<ViewId, "reorder-tabs" | "close-and-select" | "split-view">;
  type NativeHistoryView = Extract<ViewId, "navigation" | "recently-closed">;
  type NativeWorkspaceView = Extract<ViewId, "move-to-workspace">;
  type NativeContainerView = Extract<ViewId, "open-in-container">;
  type NativeFolderView = Extract<ViewId, "move-to-folder">;
  type NativeProfileView = Extract<ViewId, "profiles">;

  const client = createTabIndexClient();
  const containerClient = createContainerClient();
  const extensionClient = createExtensionClient();
  const folderClient = createFolderClient();
  const historyClient = createHistoryClient();
  const profileClient = createProfileClient();
  const tabInfoClient = createTabInfoClient();
  const workspaceClient = createWorkspaceClient();
  const actionSections = buildActionsMenuModel();
  const listViewTitles: Record<NativeListView, string> = {
    "last-visited": "Recent",
    "unvisited-tabs": "New tabs",
    "tabs-by-age": "Tabs by age",
    "most-visited": "Most visited",
    "domain-tabs": "",
    "child-tabs": "Children",
    "sibling-tabs": "Siblings",
    "parent-tabs": "Parent tabs",
    "domains": "Domains",
  };

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
  let chordBridgeReady = false;
  let dispatchRunning = false;
  let warmRearmGeneration = 0;
  let pageAlive = true;
  const heldLiveKeys: BridgeKeyData[] = [];
  const liveDispatchQueue: BridgeKeyData[] = [];

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
  const title = $derived(
    currentView === "domain-tabs" && currentDomain
      ? currentDomain
      : currentView in listViewTitles
      ? listViewTitles[currentView as NativeListView]
      : currentView === "navigation"
      ? "Tab history"
      : currentView === "recently-closed"
      ? "Recently closed"
      : currentView === "duplicates"
      ? "Duplicates"
      : currentView === "tab-info"
      ? "Tab info"
      : currentView === "duplicate-prompt"
      ? "Duplicate tab already open"
      : currentView === "move-to-workspace"
      ? "Move to workspace"
      : currentView === "open-in-container"
      ? "New container tab"
      : currentView === "move-to-folder"
      ? "Move to folder"
      : currentView === "profiles"
      ? "Profiles"
      : allActionItems.find((item) => item.view === currentView)?.label ?? "",
  );
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
  const sidebarHintsOnly = $derived(currentView === "recently-closed");
  const sidebarSortLabel = $derived(
    currentView === "domains"
      ? `Sort by ${domainsSortAlpha ? "count" : "A-Z"}`
      : currentView === "tabs-by-age"
      ? `Sort by ${tabsByAgeNewestFirst ? "oldest" : "newest"}`
      : null,
  );
  const sidebarHints = $derived<SidebarHint[]>([
    ...(isCloseableSidebarView(currentView)
      ? [{ id: "close", label: "Close tab", badge: "W", hidden: selectedIndex < 0, onclick: closeSelectedTabRow }]
      : []),
    ...(currentView === "child-tabs"
      ? [{ id: "close-all", label: "Close all", badge: "⇧W", onclick: closeAllRowsInView }]
      : []),
    ...(currentView === "recently-closed"
      ? [{ id: "restore", label: "Restore tab", badge: "O", hidden: selectedIndex < 0, onclick: restoreSelectedRecentlyClosed }]
      : []),
    ...(currentView === "parent-tabs"
      ? [{ id: "children", label: "Show children", badge: "→", hidden: selectedIndex < 0, onclick: drillSelectedParent }]
      : []),
  ]);
  const sidebarHidden = $derived(
    sidebarHintsOnly
      ? selectedIndex < 0
      : !isWorkspaceFilterView(currentView) && sidebarHints.length === 0 && !sidebarSortLabel,
  );
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

  function isNativeListView(view: ViewId | undefined): view is NativeListView {
    return isNativeTabView(view) || view === "domains";
  }

  function isNativeHistoryView(view: ViewId | undefined): view is NativeHistoryView {
    return view === "navigation" || view === "recently-closed";
  }

  function isNativeWorkspaceView(view: ViewId | undefined): view is NativeWorkspaceView {
    return view === "move-to-workspace";
  }

  function isNativeContainerView(view: ViewId | undefined): view is NativeContainerView {
    return view === "open-in-container";
  }

  function isNativeFolderView(view: ViewId | undefined): view is NativeFolderView {
    return view === "move-to-folder";
  }

  function isNativeProfileView(view: ViewId | undefined): view is NativeProfileView {
    return view === "profiles";
  }

  function isNativeDuplicateView(view: ViewId | undefined): view is NativeDuplicateView {
    return view === "duplicates";
  }

  function isNativeTabInfoView(view: ViewId | undefined): view is NativeTabInfoView {
    return view === "tab-info";
  }

  function isNativeDuplicatePromptView(view: ViewId | undefined): view is NativeDuplicatePromptView {
    return view === "duplicate-prompt";
  }

  function isNativeTabView(view: ViewId | undefined): view is NativeTabView {
    return (
      view === "child-tabs" ||
      view === "sibling-tabs" ||
      view === "parent-tabs" ||
      view === "last-visited" ||
      view === "unvisited-tabs" ||
      view === "tabs-by-age" ||
      view === "most-visited" ||
      view === "domain-tabs"
    );
  }

  function isNativePrefixView(view: ViewId | undefined): view is NativePrefixView {
    return view === "reorder-tabs" || view === "close-and-select" || view === "split-view";
  }

  function isWorkspaceFilterView(view: ViewId | undefined) {
    return isNativeListView(view) || view === "duplicates";
  }

  function isCloseableSidebarView(view: ViewId | undefined) {
    return (
      view === "child-tabs" ||
      view === "sibling-tabs" ||
      view === "parent-tabs" ||
      view === "unvisited-tabs" ||
      view === "last-visited" ||
      view === "domain-tabs" ||
      view === "most-visited" ||
      view === "tabs-by-age"
    );
  }

  function isDomainRow(row: NativeRow | null): row is DomainIndexRow {
    return row?.kind === "domain";
  }

  function isTabRow(row: NativeRow | null): row is TabIndexRow {
    return !!row && row.kind !== "domain";
  }

  function viewParams(view: NativeListView) {
    const params: Record<string, unknown> = {};
    if (workspaceFilter !== "all") params.workspaceId = workspaceFilter;
    if (view === "domain-tabs" && currentDomain) params.domain = currentDomain;
    if (view === "domains") params.sortAlpha = domainsSortAlpha;
    if (view === "tabs-by-age") params.newestFirst = tabsByAgeNewestFirst;
    return params;
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
    const load = viewLoad.begin(view, { loading: resetSelection });
    offset = nextOffset;
    void refreshSidebarWorkspaces(load.id);
    try {
      await client.ensureStarted();
      const win = await client.getWindow<NativeRow>(view as TabIndexView, nextOffset, limit, params);
      await load.commit(() => {
        rows = win.rows;
        total = win.total;
        if (resetSelection) {
          selectedIndex = -1;
        }
      });
    } catch (err) {
      await load.fail(err, (message) => {
        rows = [];
        total = 0;
        selectedIndex = -1;
        error = message;
      });
    } finally {
      load.finish();
    }
  }

  async function loadNavigation() {
    const load = viewLoad.begin("navigation");
    try {
      const result = await loadNavigationView(historyClient);
      await load.commit(() => {
        navigationHistory = result.history;
        selectedIndex = result.selectedIndex;
      });
    } catch (err) {
      await load.fail(err, (message) => {
        navigationHistory = null;
        selectedIndex = -1;
        error = message;
      });
    } finally {
      load.finish();
    }
  }

  async function loadRecentlyClosed() {
    const load = viewLoad.begin("recently-closed");
    try {
      const result = await loadRecentlyClosedView(historyClient);
      await load.commit(() => {
        recentlyClosedRows = result.rows;
        selectedIndex = result.selectedIndex;
      });
    } catch (err) {
      await load.fail(err, (message) => {
        recentlyClosedRows = [];
        selectedIndex = -1;
        error = message;
      });
    } finally {
      load.finish();
    }
  }

  async function loadMoveToWorkspace() {
    const load = viewLoad.begin("move-to-workspace");
    try {
      const result = await loadMoveToWorkspaceView(workspaceClient);
      await load.commit(() => {
        workspaceRows = result.rows;
        selectedIndex = result.selectedIndex;
      });
    } catch (err) {
      await load.fail(err, (message) => {
        workspaceRows = [];
        selectedIndex = -1;
        error = message;
      });
    } finally {
      load.finish();
    }
  }

  async function loadOpenInContainer() {
    const load = viewLoad.begin("open-in-container");
    try {
      const result = await loadOpenInContainerView(containerClient);
      await load.commit(() => {
        containerRows = result.rows;
        selectedIndex = result.selectedIndex;
      });
    } catch (err) {
      await load.fail(err, (message) => {
        containerRows = [];
        selectedIndex = -1;
        error = message;
      });
    } finally {
      load.finish();
    }
  }

  async function loadMoveToFolder() {
    const load = viewLoad.begin("move-to-folder");
    try {
      const result = await loadMoveToFolderView(folderClient, workspaceClient);
      await load.commit(() => {
        folderRows = result.folders;
        folderWorkspaces = result.workspaces;
        selectedIndex = result.selectedIndex;
      });
    } catch (err) {
      await load.fail(err, (message) => {
        folderRows = [];
        folderWorkspaces = [];
        selectedIndex = -1;
        error = message;
      });
    } finally {
      load.finish();
    }
  }

  async function loadProfiles() {
    const load = viewLoad.begin("profiles");
    try {
      const result = await loadProfilesView(profileClient);
      await load.commit(() => {
        profileRows = result.rows;
        selectedIndex = result.selectedIndex;
      });
    } catch (err) {
      await load.fail(err, (message) => {
        profileRows = [];
        selectedIndex = -1;
        error = message;
      });
    } finally {
      load.finish();
    }
  }

  async function loadDuplicates() {
    const load = viewLoad.begin("duplicates");
    try {
      const result = await loadDuplicateGroupsView(tabIndexClient, workspaceClient, workspaceFilter);
      await load.commit(() => {
        sidebarWorkspaces = result.workspaces;
        duplicateWorkspaces = result.workspaces;
        workspaceFilter = result.workspaceFilter;
        duplicateGroups = result.groups;
        selectedIndex = result.selectedIndex;
      });
    } catch (err) {
      await load.fail(err, (message) => {
        duplicateGroups = [];
        duplicateWorkspaces = [];
        selectedIndex = -1;
        error = message;
      });
    } finally {
      load.finish();
    }
  }

  async function loadTabInfo() {
    const load = viewLoad.begin("tab-info");
    try {
      const result = await loadTabInfoView(tabIndexClient, tabInfoClient, workspaceClient);
      await load.commit(() => {
        tabInfo = result.info;
        tabInfoVisits = result.visits;
        tabInfoDuplicates = result.duplicates;
        tabInfoWorkspaces = result.workspaces;
        selectedIndex = result.selectedIndex;
      });
    } catch (err) {
      await load.fail(err, (message) => {
        tabInfo = null;
        tabInfoVisits = [];
        tabInfoDuplicates = [];
        tabInfoWorkspaces = [];
        selectedIndex = -1;
        error = message;
      });
    } finally {
      load.finish();
    }
  }

  function loadDuplicatePrompt(params = new URLSearchParams(location.search)) {
    viewLoad.begin("duplicate-prompt", { loading: false });
    duplicatePromptUrl = params.get("url") || "";
    duplicatePromptDomId = params.get("domId");
    selectedIndex = -1;
  }

  function encodedParams(params?: URLSearchParams | Record<string, unknown>) {
    if (!params) return undefined;
    if (params instanceof URLSearchParams) {
      return JSON.stringify(Object.fromEntries(params.entries()));
    }
    return JSON.stringify(params);
  }

  function paramsRecord(params?: URLSearchParams | Record<string, unknown>) {
    if (!params) return {};
    if (params instanceof URLSearchParams) return Object.fromEntries(params.entries());
    return params;
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
    if (view === "actions") {
      goBack();
      await loadActionsData();
      return finishOpenView(view);
    }
    if (isNativeListView(view)) {
      currentDomain = paramValue(params, "domain");
      await loadListView(view, 0, 80, true, { ...paramsRecord(params), ...viewParams(view) });
      return finishOpenView(view);
    }
    if (isNativePrefixView(view)) {
      currentView = view;
      selectedIndex = -1;
      error = null;
      return finishOpenView(view);
    }
    if (view === "navigation") {
      await loadNavigation();
      return finishOpenView(view);
    }
    if (view === "recently-closed") {
      await loadRecentlyClosed();
      return finishOpenView(view);
    }
    if (view === "move-to-workspace") {
      await loadMoveToWorkspace();
      return finishOpenView(view);
    }
    if (view === "open-in-container") {
      await loadOpenInContainer();
      return finishOpenView(view);
    }
    if (view === "move-to-folder") {
      await loadMoveToFolder();
      return finishOpenView(view);
    }
    if (view === "profiles") {
      await loadProfiles();
      return finishOpenView(view);
    }
    if (view === "duplicates") {
      await loadDuplicates();
      return finishOpenView(view);
    }
    if (view === "tab-info") {
      await loadTabInfo();
      return finishOpenView(view);
    }
    if (view === "duplicate-prompt") {
      loadDuplicatePrompt(params instanceof URLSearchParams ? params : undefined);
      return finishOpenView(view);
    }
    return false;
  }

  function paramValue(params: URLSearchParams | Record<string, unknown> | undefined, key: string) {
    if (!params) return null;
    if (params instanceof URLSearchParams) return params.get(key);
    const value = params[key];
    return typeof value === "string" ? value : null;
  }

  async function performActionItem(item: ActionMenuItem) {
    if (item.disabled) {
      return;
    }

    if (item.kind === "action") {
      clearPopupRevealTimer();
      fireMessage({ type: item.id });
      return;
    }

    if (item.kind === "workspace-switch" && item.workspaceId && !item.disabled) {
      switchWorkspace(item.workspaceId);
      return;
    }

    if (item.kind === "prefix" && isNativePrefixView(item.view as ViewId | undefined)) {
      await openNativeView(item.view as NativePrefixView, undefined, true);
      return;
    }

    if (item.view) await openNativeView(item.view as ViewId, undefined, true);
  }

  async function activateAction(item: ActionMenuItem) {
    if (item.disabled) return;

    if (item.kind === "workspace-switch" && item.workspaceId) {
      switchWorkspace(item.workspaceId);
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
    duplicateGroups = duplicateGroups
      .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => tab.domId !== row.domId) }))
      .filter((group) => group.tabs.length > 1);
  }

  function closeSelectedTabRow() {
    const row = selectedTabRow;
    if (!row) return;
    fireMessage({ type: "close-tab", domId: row.domId });
    rows = rows.filter((candidate) => !isTabRow(candidate) || candidate.domId !== row.domId);
    total = Math.max(0, total - 1);
    if (total === 0) {
      selectedIndex = -1;
    } else if (selectedIndex >= total) {
      selectedIndex = total - 1;
    }
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
    recentlyClosedRows = recentlyClosedRows.filter((candidate) => candidate.sessionId !== row.sessionId);
    if (recentlyClosedRows.length === 0) {
      selectedIndex = -1;
    } else if (selectedIndex >= recentlyClosedRows.length) {
      selectedIndex = recentlyClosedRows.length - 1;
    }
  }

  async function drillSelectedParent() {
    if (currentView !== "parent-tabs" || !selectedTabRow) return;
    await openNativeView("child-tabs", { ...viewParams("child-tabs"), parentDomId: selectedTabRow.domId }, true);
  }

  async function toggleCurrentSort() {
    if (currentView === "domains" || currentView === "domain-tabs") {
      domainsSortAlpha = !domainsSortAlpha;
      if (currentView === "domains") await loadListView("domains");
      else await loadListView("domain-tabs", 0, 80, true, viewParams("domain-tabs"));
      return;
    }
    if (currentView === "tabs-by-age") {
      tabsByAgeNewestFirst = !tabsByAgeNewestFirst;
      await loadListView("tabs-by-age");
    }
  }

  async function reloadWorkspaceFilteredView() {
    if (isNativeListView(currentView)) {
      await loadListView(currentView);
      return;
    }
    if (currentView === "duplicates") {
      await loadDuplicates();
    }
  }

  async function setWorkspaceFilter(nextFilter: string) {
    workspaceFilter = nextFilter || "all";
    await reloadWorkspaceFilteredView();
  }

  async function toggleWorkspaceFilter() {
    await setWorkspaceFilter(workspaceFilter === "all" ? activeWorkspaceId || "all" : "all");
  }

  async function filterWorkspaceByIndex(index: number) {
    const workspace = sidebarWorkspaces[index];
    if (!workspace) return;
    await setWorkspaceFilter(workspaceFilter === workspace.uuid ? "all" : workspace.uuid);
  }

  function closeTabInfoDuplicate(row: TabIndexRow) {
    fireMessage({ type: "close-tab", domId: row.domId });
    tabInfoDuplicates = tabInfoDuplicates.filter((tab) => tab.domId !== row.domId);
  }

  function closeOtherTabInfoDuplicates() {
    if (!tabInfo) return;
    const selfDomId = tabInfo.domId;
    for (const duplicate of tabInfoDuplicates) {
      if (duplicate.domId !== selfDomId) {
        fireMessage({ type: "close-tab", domId: duplicate.domId });
      }
    }
    tabInfoDuplicates = tabInfoDuplicates.filter((tab) => tab.domId === selfDomId);
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

  function goBack() {
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
    void loadActionsData();
  }

  function isSelectableIndex(index: number) {
    if (currentView === "profiles") {
      return !!profileRows[index] && !profileRows[index].isCurrent;
    }
    if (currentView === "duplicates") {
      return false;
    }
    if (currentView === "tab-info") {
      return false;
    }
    if (currentView === "duplicate-prompt") {
      return index >= 0 && index < 3;
    }
    return index >= 0;
  }

  function moveSelection(delta: 1 | -1) {
    const length = currentView === "actions"
      ? visibleActionItems.length
      : isNativePrefixView(currentView)
        ? prefixItems.length
        : currentView === "navigation"
          ? navigationEntries.length
        : currentView === "recently-closed"
          ? recentlyClosedRows.length
          : currentView === "move-to-workspace"
            ? workspaceRows.length
            : currentView === "open-in-container"
              ? containerRows.length
              : currentView === "move-to-folder"
                ? folderRows.length
              : currentView === "profiles"
                ? profileRows.length
              : currentView === "duplicates"
                ? 0
              : currentView === "tab-info"
                ? 0
              : currentView === "duplicate-prompt"
                ? 3
        : rows.length;
    if (!length) {
      selectedIndex = -1;
      return;
    }

    let next = selectedIndex < 0 ? (delta > 0 ? -1 : 0) : selectedIndex;
    for (let attempts = 0; attempts < length; attempts += 1) {
      next = (next + delta + length) % length;
      if (isSelectableIndex(next)) {
        selectedIndex = next;
        break;
      }
    }
    if (currentView !== "actions" && !isNativePrefixView(currentView)) {
      ensureListIndexLoaded(selectedIndex);
      scrollListIndexIntoView(selectedIndex);
    }
  }

  function cyclePage(delta: 1 | -1) {
    setActionsPage(currentPage + delta);
  }

  function setActionsPage(targetPage: number) {
    if (currentView !== "actions" || pageCount <= 1) return;
    let nextPage = targetPage;
    if (nextPage < 1) nextPage = pageCount;
    if (nextPage > pageCount) nextPage = 1;
    if (nextPage === currentPage) return;
    currentPage = nextPage;
    selectedIndex = -1;
    clearPreview();
  }

  function jumpSection(delta: 1 | -1) {
    if (currentView !== "actions") return;
    const starts: number[] = [];
    let index = 0;
    for (const section of actionSections) {
      if (section.page !== currentPage) continue;
      if (section.items.length > 0) starts.push(index);
      index += section.items.length;
    }
    if (!starts.length) return;
    const currentStartIndex = starts.findIndex((start, i) => {
      const next = starts[i + 1] ?? visibleActionItems.length;
      return selectedIndex >= start && selectedIndex < next;
    });
    const base = currentStartIndex >= 0 ? currentStartIndex : 0;
    selectedIndex = starts[(base + delta + starts.length) % starts.length];
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
    const relativeIndex = index - offset;
    return relativeIndex >= 0 ? rows[relativeIndex] ?? null : null;
  }

  function ensureListIndexLoaded(index: number) {
    if (!isNativeListView(currentView)) return;
    if (index >= offset && index < offset + rows.length) return;
    const nextOffset = Math.max(0, index - 20);
    loadListView(currentView, nextOffset, 80, false);
  }

  function scrollListIndexIntoView(index: number) {
    requestAnimationFrame(() => {
      const list = document.getElementById("list");
      if (!list) return;
      const rowHeight = 40;
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      if (top < list.scrollTop) {
        list.scrollTop = top;
      } else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
    });
  }

  function loadVisibleRange(nextOffset: number, limit: number) {
    if (!isNativeListView(currentView)) return;
    loadListView(currentView, nextOffset, Math.max(60, limit), false, viewParams(currentView));
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

  async function runLiveDispatchQueue() {
    if (dispatchRunning) return;
    dispatchRunning = true;
    try {
      while (liveDispatchQueue.length > 0) {
        const input = liveDispatchQueue.shift();
        if (!input) continue;
        armPopupRevealTimer();
        await handleKeyInput(input);
      }
    } finally {
      dispatchRunning = false;
    }
  }

  function enqueueKeyInput(input: BridgeKeyData) {
    liveDispatchQueue.push(input);
    void runLiveDispatchQueue();
  }

  function handleBridgeKey(input: BridgeKeyData) {
    if (!chordBridgeReady) {
      heldLiveKeys.push(input);
      return;
    }
    enqueueKeyInput(input);
  }

  function handleKeydown(event: KeyboardEvent) {
    const input = snapshotKeyEvent(event);
    if (!chordBridgeReady) {
      event.preventDefault();
      event.stopPropagation();
      heldLiveKeys.push(input);
      return;
    }
    event.preventDefault();
    enqueueKeyInput(input);
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
    let listContentHeight = 8;
    const children = list?.children ?? [];
    if (children.length > 0) {
      const first = children[0].getBoundingClientRect();
      const last = children[children.length - 1].getBoundingClientRect();
      listContentHeight += Math.max(0, last.bottom - first.top);
    }
    let totalHeight = listContentHeight;
    if (header && !header.classList.contains("hidden") && header.children.length > 0) {
      totalHeight += header.getBoundingClientRect().height;
    }
    if (indicator && !indicator.classList.contains("hidden")) {
      totalHeight += indicator.getBoundingClientRect().height;
    }
    return totalHeight;
  }

  async function requestPanelResize(view: ViewId = currentView) {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!pageAlive) return;
    fireMessage({ type: "resize-panel", view, height: measureNaturalHeight() });
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

    const buffered = Array.isArray(reply?.buffered) ? reply.buffered : [];
    const held = heldLiveKeys.splice(0);
    for (const input of buffered) {
      if (generation !== undefined && generation !== warmRearmGeneration) return;
      armPopupRevealTimer();
      await handleKeyInput(input);
    }
    for (const input of held) {
      if (generation !== undefined && generation !== warmRearmGeneration) return;
      armPopupRevealTimer();
      await handleKeyInput(input);
    }

    if (generation !== undefined && generation !== warmRearmGeneration) return;
    chordBridgeReady = true;
    if (buffered.length === 0 && held.length === 0) {
      armPopupRevealTimer();
    }
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
    const generation = ++warmRearmGeneration;
    if (typeof data.inst === "number") popupInst = data.inst;
    chordBridgeReady = false;
    clearPopupRevealTimer();
    liveDispatchQueue.length = 0;
    heldLiveKeys.length = 0;
    clearPreview();

    const view = data.view || "actions";
    await openNativeView(view, data.params || {});
    if (generation !== warmRearmGeneration) return;
    await requestPanelResize(view);
    if (generation !== warmRearmGeneration) return;
    const reply = await signalPopupReady();
    await drainBridge(reply, generation);
  }

  function handleForceReady(data: ForceReadyPayload) {
    const buffered = Array.isArray(data.buffered) ? data.buffered : [];
    const held = heldLiveKeys.splice(0);
    chordBridgeReady = true;
    clearPopupRevealTimer();
    for (const input of buffered) {
      enqueueKeyInput(input);
    }
    for (const input of held) {
      enqueueKeyInput(input);
    }
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
