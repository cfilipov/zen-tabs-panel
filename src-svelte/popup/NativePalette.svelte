<script lang="ts">
  import { onMount } from "svelte";
  import PaletteShell from "./components/PaletteShell.svelte";
  import ActionsMenu from "./views/ActionsMenu.svelte";
  import ContainerList from "./views/ContainerList.svelte";
  import DomainList from "./views/DomainList.svelte";
  import DuplicateGroups from "./views/DuplicateGroups.svelte";
  import DuplicatePrompt, { type DuplicatePromptAction } from "./views/DuplicatePrompt.svelte";
  import FolderList from "./views/FolderList.svelte";
  import PrefixMenu from "./views/PrefixMenu.svelte";
  import NavigationList from "./views/NavigationList.svelte";
  import ProfileList from "./views/ProfileList.svelte";
  import RecentlyClosedList from "./views/RecentlyClosedList.svelte";
  import TabList from "./views/TabList.svelte";
  import TabInfoView from "./views/TabInfoView.svelte";
  import WorkspaceList from "./views/WorkspaceList.svelte";
  import { inputFromKeyboardEvent } from "./interaction/inputs";
  import { interpretVisibleInput, type InteractionCommand } from "./interaction/interpreter";
  import { createContainerClient, type ContainerRow } from "./runtime/container-client";
  import { createFolderClient, type FolderRow } from "./runtime/folder-client";
  import { createHistoryClient, type NavigationHistory, type RecentlyClosedRow } from "./runtime/history-client";
  import { fireMessage, sendMessage } from "./runtime/ipc";
  import { createProfileClient, type ProfileRow } from "./runtime/profile-client";
  import { createTabInfoClient, type HistoryVisit, type TabInfo } from "./runtime/tab-info-client";
  import {
    createTabIndexClient,
    type DomainIndexRow,
    type DuplicateGroupRow,
    type TabIndexRow,
    type TabIndexView,
  } from "./runtime/tab-index-client";
  import { createWorkspaceClient, type WorkspaceRow } from "./runtime/workspace-client";
  import { domainOf } from "./views/url";
  import {
    actionItemsForPage,
    actionNodesForSections,
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
  let selectedIndex = $state(0);
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
  let loadGeneration = 0;

  const headerHidden = $derived(currentView === "actions");
  const pageCount = $derived(Math.max(1, Math.max(...actionSections.map((section) => section.page))));
  const visibleActionItems = $derived(actionItemsForPage(actionSections, currentPage));
  const allActionItems = $derived(actionSections.flatMap((section) => section.items));
  const allActionNodes = $derived(actionNodesForSections(actionSections));
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

  function isDomainRow(row: NativeRow | null): row is DomainIndexRow {
    return row?.kind === "domain";
  }

  function isTabRow(row: NativeRow | null): row is TabIndexRow {
    return !!row && row.kind !== "domain";
  }

  function viewParams(view: NativeListView) {
    return view === "domain-tabs" && currentDomain ? { domain: currentDomain } : {};
  }

  async function loadListView(view: NativeListView, nextOffset = 0, limit = 80, resetSelection = true, params = viewParams(view)) {
    const generation = ++loadGeneration;
    if (resetSelection) {
      loading = true;
    }
    error = null;
    currentView = view;
    offset = nextOffset;
    try {
      await client.ensureStarted();
      const win = await client.getWindow<NativeRow>(view as TabIndexView, nextOffset, limit, params);
      if (generation !== loadGeneration || currentView !== view) {
        return;
      }
      rows = win.rows;
      total = win.total;
      if (resetSelection) {
        selectedIndex = win.rows.length ? win.offset : -1;
      }
    } catch (err) {
      if (generation !== loadGeneration) {
        return;
      }
      rows = [];
      total = 0;
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) {
        loading = false;
      }
    }
  }

  async function loadNavigation() {
    const generation = ++loadGeneration;
    loading = true;
    error = null;
    currentView = "navigation";
    try {
      const history = await historyClient.getNavigationHistory();
      if (generation !== loadGeneration || currentView !== "navigation") return;
      navigationHistory = history;
      selectedIndex = history?.entries.length ? history.index : -1;
    } catch (err) {
      if (generation !== loadGeneration) return;
      navigationHistory = null;
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  async function loadRecentlyClosed() {
    const generation = ++loadGeneration;
    loading = true;
    error = null;
    currentView = "recently-closed";
    try {
      const entries = await historyClient.getRecentlyClosed();
      if (generation !== loadGeneration || currentView !== "recently-closed") return;
      recentlyClosedRows = entries;
      selectedIndex = entries.length ? 0 : -1;
    } catch (err) {
      if (generation !== loadGeneration) return;
      recentlyClosedRows = [];
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  async function loadMoveToWorkspace() {
    const generation = ++loadGeneration;
    loading = true;
    error = null;
    currentView = "move-to-workspace";
    try {
      const workspaces = await workspaceClient.getWorkspacesWithIcons();
      if (generation !== loadGeneration || currentView !== "move-to-workspace") return;
      workspaceRows = workspaces.filter((workspace) => !workspace.isActive);
      selectedIndex = workspaceRows.length ? 0 : -1;
    } catch (err) {
      if (generation !== loadGeneration) return;
      workspaceRows = [];
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  async function loadOpenInContainer() {
    const generation = ++loadGeneration;
    loading = true;
    error = null;
    currentView = "open-in-container";
    try {
      const containers = await containerClient.getContainers();
      if (generation !== loadGeneration || currentView !== "open-in-container") return;
      containerRows = containers;
      selectedIndex = containers.length ? 0 : -1;
    } catch (err) {
      if (generation !== loadGeneration) return;
      containerRows = [];
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  async function loadMoveToFolder() {
    const generation = ++loadGeneration;
    loading = true;
    error = null;
    currentView = "move-to-folder";
    try {
      const [folders, workspaces] = await Promise.all([
        folderClient.getFolders(),
        workspaceClient.getWorkspacesWithIcons().catch(() => []),
      ]);
      if (generation !== loadGeneration || currentView !== "move-to-folder") return;
      folderRows = folders;
      folderWorkspaces = workspaces;
      selectedIndex = folders.length ? 0 : -1;
    } catch (err) {
      if (generation !== loadGeneration) return;
      folderRows = [];
      folderWorkspaces = [];
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  function firstSelectableProfileIndex(rows: ProfileRow[]) {
    return rows.findIndex((row) => !row.isCurrent);
  }

  async function loadProfiles() {
    const generation = ++loadGeneration;
    loading = true;
    error = null;
    currentView = "profiles";
    try {
      const profiles = await profileClient.getProfiles();
      if (generation !== loadGeneration || currentView !== "profiles") return;
      profileRows = profiles;
      selectedIndex = firstSelectableProfileIndex(profiles);
    } catch (err) {
      if (generation !== loadGeneration) return;
      profileRows = [];
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  async function loadDuplicates() {
    const generation = ++loadGeneration;
    loading = true;
    error = null;
    currentView = "duplicates";
    try {
      const [allTabs, workspaces] = await Promise.all([
        sendMessage<TabIndexRow[]>({ type: "get-all-tabs" }),
        workspaceClient.getWorkspacesWithIcons().catch(() => []),
      ]);
      if (generation !== loadGeneration || currentView !== "duplicates") return;
      duplicateGroups = buildDuplicateGroups(allTabs);
      duplicateWorkspaces = workspaces;
      selectedIndex = -1;
    } catch (err) {
      if (generation !== loadGeneration) return;
      duplicateGroups = [];
      duplicateWorkspaces = [];
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  async function loadTabInfo() {
    const generation = ++loadGeneration;
    loading = true;
    error = null;
    currentView = "tab-info";
    try {
      const allTabs = await sendMessage<TabIndexRow[]>({ type: "get-all-tabs" });
      const active = allTabs.find((tab) => tab.active);
      if (!active) {
        if (generation !== loadGeneration || currentView !== "tab-info") return;
        tabInfo = null;
        tabInfoVisits = [];
        tabInfoDuplicates = [];
        tabInfoWorkspaces = [];
        selectedIndex = -1;
        return;
      }
      const info = await tabInfoClient.getTabInfo(active.domId);
      if (generation !== loadGeneration || currentView !== "tab-info") return;
      if (!info) {
        tabInfo = null;
        tabInfoVisits = [];
        tabInfoDuplicates = [];
        tabInfoWorkspaces = [];
        selectedIndex = -1;
        return;
      }

      const titleByUrl = new Map<string, string>();
      for (const entry of info.sessionEntries) {
        if (entry.url && !titleByUrl.has(entry.url)) titleByUrl.set(entry.url, entry.title);
      }
      if (info.url && !titleByUrl.has(info.url)) titleByUrl.set(info.url, info.title);
      const urls = new Set<string>();
      if (info.url && !info.url.startsWith("about:")) urls.add(info.url);
      for (const entry of info.sessionEntries) {
        if (entry.url && !entry.url.startsWith("about:")) urls.add(entry.url);
      }
      const [visitLists, workspaces] = await Promise.all([
        Promise.all([...urls].map((url) => tabInfoClient.getHistoryVisits(url).then(
          (visits) => visits.map((visit) => ({ ...visit, url, title: titleByUrl.get(url) || url })),
          () => [],
        ))),
        workspaceClient.getWorkspacesWithIcons().catch(() => []),
      ]);
      if (generation !== loadGeneration || currentView !== "tab-info") return;
      tabInfo = info;
      tabInfoVisits = visitLists.flat();
      tabInfoDuplicates = allTabs.filter((tab) => info.duplicateDomIds.includes(tab.domId));
      tabInfoWorkspaces = workspaces;
      selectedIndex = -1;
    } catch (err) {
      if (generation !== loadGeneration) return;
      tabInfo = null;
      tabInfoVisits = [];
      tabInfoDuplicates = [];
      tabInfoWorkspaces = [];
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  function loadDuplicatePrompt(params = new URLSearchParams(location.search)) {
    ++loadGeneration;
    loading = false;
    error = null;
    currentView = "duplicate-prompt";
    duplicatePromptUrl = params.get("url") || "";
    duplicatePromptDomId = params.get("domId");
    selectedIndex = 0;
  }

  function openNativeView(view: ViewId, params?: URLSearchParams) {
    if (view === "actions") {
      goBack();
      return true;
    }
    if (isNativeListView(view)) {
      currentDomain = params?.get("domain") ?? null;
      loadListView(view, 0, 80, true, viewParams(view));
      return true;
    }
    if (isNativePrefixView(view)) {
      currentView = view;
      selectedIndex = 0;
      error = null;
      return true;
    }
    if (view === "navigation") {
      loadNavigation();
      return true;
    }
    if (view === "recently-closed") {
      loadRecentlyClosed();
      return true;
    }
    if (view === "move-to-workspace") {
      loadMoveToWorkspace();
      return true;
    }
    if (view === "open-in-container") {
      loadOpenInContainer();
      return true;
    }
    if (view === "move-to-folder") {
      loadMoveToFolder();
      return true;
    }
    if (view === "profiles") {
      loadProfiles();
      return true;
    }
    if (view === "duplicates") {
      loadDuplicates();
      return true;
    }
    if (view === "tab-info") {
      loadTabInfo();
      return true;
    }
    if (view === "duplicate-prompt") {
      loadDuplicatePrompt(params);
      return true;
    }
    return false;
  }

  function buildDuplicateGroups(allTabs: TabIndexRow[]): DuplicateGroupRow[] {
    const groups = new Map<string, TabIndexRow[]>();
    for (const tab of allTabs) {
      if (!tab.url || tab.url === "about:newtab" || tab.url === "about:blank") continue;
      const group = groups.get(tab.url);
      if (group) group.push(tab);
      else groups.set(tab.url, [tab]);
    }
    return [...groups.values()]
      .filter((group) => group.length > 1)
      .sort((a, b) => b.length - a.length)
      .map((tabs) => {
        const sample = tabs[0];
        return {
          kind: "duplicate-group",
          url: sample.url,
          title: sample.title,
          domain: sample.domain || domainOf(sample.url),
          favIconUrl: sample.favIconUrl,
          tabs,
        };
      });
  }

  function activateAction(item: ActionMenuItem) {
    if (item.disabled) {
      return;
    }

    if (item.kind === "action") {
      fireMessage({ type: item.id });
      return;
    }

    if (item.kind === "prefix" && isNativePrefixView(item.view as ViewId | undefined)) {
      openNativeView(item.view as NativePrefixView);
      return;
    }

    if (item.view) openNativeView(item.view as ViewId);
  }

  function activateTab(row: TabIndexRow) {
    fireMessage({ type: "activate-tab", domId: row.domId });
  }

  function activateTabLike(row: { domId: string }) {
    fireMessage({ type: "activate-tab", domId: row.domId });
  }

  function activateDomain(row: DomainIndexRow) {
    currentDomain = row.domain;
    loadListView("domain-tabs", 0, 80, true, { domain: row.domain });
  }

  function navigateToHistoryIndex(index: number) {
    fireMessage({ type: "navigate-to-history-index", index });
  }

  function restoreClosedTab(row: RecentlyClosedRow, keepOpen = false) {
    fireMessage({
      type: keepOpen ? "restore-closed-tab-keep-open" : "restore-closed-tab",
      sessionId: row.sessionId,
    });
  }

  function moveToWorkspace(row: WorkspaceRow) {
    fireMessage({ type: "move-selected-tabs-to-workspace", workspaceId: row.uuid });
  }

  function reopenInContainer(row: ContainerRow) {
    fireMessage({ type: "reopen-in-container", userContextId: row.userContextId });
  }

  function moveToFolder(row: FolderRow) {
    fireMessage({ type: "move-tab-to-folder", folderId: row.id });
  }

  function launchProfile(row: ProfileRow) {
    if (row.isCurrent) return;
    fireMessage({ type: "launch-profile", name: row.name });
  }

  function closeDuplicateTab(row: TabIndexRow) {
    fireMessage({ type: "close-tab", domId: row.domId });
    duplicateGroups = duplicateGroups
      .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => tab.domId !== row.domId) }))
      .filter((group) => group.tabs.length > 1);
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
    selectedIndex = 0;
    error = null;
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
    currentPage = ((currentPage - 1 + delta + pageCount) % pageCount) + 1;
    selectedIndex = 0;
  }

  function activateSelected() {
    if (currentView === "actions") {
      const item = visibleActionItems[selectedIndex];
      if (item) activateAction(item);
      return;
    }

    if (isNativePrefixView(currentView)) {
      const item = prefixItems[selectedIndex];
      if (item) activateAction(item);
      return;
    }

    if (selectedTabRow) activateTab(selectedTabRow);
    else if (selectedDomainRow) activateDomain(selectedDomainRow);
    else if (currentView === "navigation" && selectedIndex !== navigationHistory?.index) navigateToHistoryIndex(selectedIndex);
    else if (currentView === "recently-closed") {
      const row = recentlyClosedRows[selectedIndex];
      if (row) restoreClosedTab(row);
    } else if (currentView === "move-to-workspace") {
      const row = workspaceRows[selectedIndex];
      if (row) moveToWorkspace(row);
    } else if (currentView === "open-in-container") {
      const row = containerRows[selectedIndex];
      if (row) reopenInContainer(row);
    } else if (currentView === "move-to-folder") {
      const row = folderRows[selectedIndex];
      if (row) moveToFolder(row);
    } else if (currentView === "profiles") {
      const row = profileRows[selectedIndex];
      if (row) launchProfile(row);
    } else if (currentView === "duplicate-prompt") {
      const action: DuplicatePromptAction[] = ["duplicate-switch", "duplicate-open-anyway", "hide-palette"];
      const selected = action[selectedIndex];
      if (selected) runDuplicatePromptAction(selected);
    }
  }

  function activateRow(index: number) {
    if (currentView === "navigation") {
      const targets = navigationEntries
        .map((entry, navIndex) => ({ entry, navIndex }))
        .filter((candidate) => candidate.navIndex !== navigationHistory?.index);
      const target = targets[index];
      if (target) navigateToHistoryIndex(target.navIndex);
      return;
    }

    if (currentView === "recently-closed") {
      const row = recentlyClosedRows[index];
      if (row) restoreClosedTab(row);
      return;
    }

    if (currentView === "move-to-workspace") {
      const row = workspaceRows[index];
      if (row) moveToWorkspace(row);
      return;
    }

    if (currentView === "open-in-container") {
      const row = containerRows[index];
      if (row) reopenInContainer(row);
      return;
    }

    if (currentView === "move-to-folder") {
      const row = folderRows[index];
      if (row) moveToFolder(row);
      return;
    }

    if (currentView === "profiles") {
      const row = profileRows[index];
      if (row) launchProfile(row);
      return;
    }

    if (currentView === "duplicate-prompt") {
      const action: DuplicatePromptAction[] = ["duplicate-switch", "duplicate-open-anyway", "hide-palette"];
      const selected = action[index];
      if (selected) runDuplicatePromptAction(selected);
      return;
    }

    const row = rowForIndex(index);
    if (isTabRow(row)) activateTab(row);
    else if (isDomainRow(row)) activateDomain(row);
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

  function runCommand(command: InteractionCommand) {
    switch (command.kind) {
      case "action": {
        const item = [...allActionItems, ...prefixItems].find((candidate) => candidate.id === command.actionId);
        if (item) activateAction(item);
        return;
      }
      case "open-view":
        openNativeView(command.view);
        return;
      case "enter-prefix":
        openNativeView(command.view);
        return;
      case "cancel":
        fireMessage({ type: "hide-palette" });
        return;
      case "back":
        goBack();
        return;
      case "move-selection":
        moveSelection(command.delta);
        return;
      case "activate-selection":
        activateSelected();
        return;
      case "activate-row":
        activateRow(command.index);
        return;
      case "cycle-page":
        cyclePage(command.delta);
        return;
      case "none":
        return;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (currentView === "duplicate-prompt" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const key = event.key.toUpperCase();
      const actionByKey: Record<string, DuplicatePromptAction> = {
        S: "duplicate-switch",
        O: "duplicate-open-anyway",
        C: "hide-palette",
      };
      const action = actionByKey[key];
      if (action) {
        event.preventDefault();
        runDuplicatePromptAction(action);
        return;
      }
    }

    if (currentView === "navigation" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const upper = event.key.toUpperCase();
      if (upper === "B" || upper === "F") {
        const current = navigationHistory?.index ?? -1;
        const target = current + (upper === "B" ? -1 : 1);
        if (target >= 0 && target < navigationEntries.length) {
          event.preventDefault();
          navigateToHistoryIndex(target);
        }
        return;
      }
    }

    const actionNodes = currentView === "actions" ? allActionNodes : isNativePrefixView(currentView) ? prefixNodes : [];
    const command = interpretVisibleInput(inputFromKeyboardEvent(event), { view: currentView }, actionNodes);
    if (command.kind === "none") {
      return;
    }

    event.preventDefault();
    runCommand(command);
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const initialView = params.get("view") as ViewId | null;
    if (initialView) openNativeView(initialView, params);

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  $effect(() => {
    if (selectedTabRow) {
      previewTab(selectedTabRow);
    } else if (currentView === "actions") {
      clearPreview();
    }
  });
</script>

<PaletteShell {headerHidden} {title} onback={currentView === "actions" ? undefined : goBack}>
  {#if error}
    <div class="empty-state">{error}</div>
  {:else if currentView === "actions"}
    <ActionsMenu sections={actionSections} {currentPage} selectedId={selectedActionId} onactivate={activateAction} />
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
