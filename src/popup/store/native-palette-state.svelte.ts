import type { ViewId } from "../../shared/types";
import type { ContainerRow } from "../runtime/container-client";
import type { ExtensionRow } from "../runtime/extension-client";
import type { FolderRow } from "../runtime/folder-client";
import type { NavigationHistory, RecentlyClosedRow } from "../runtime/history-client";
import type { ProfileRow } from "../runtime/profile-client";
import type { HistoryVisit, TabInfo } from "../runtime/tab-info-client";
import type { ActionPreview, DuplicateGroupRow, TabIndexRow, ViewWindow } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";
import type { NativeListRow } from "../view-loaders/list-loader";
import type { ActionsMenuData } from "../view-loaders/actions-loader";
import type { DuplicatePromptData } from "../view-loaders/duplicate-prompt-loader";

export type NativePaletteState = {
  currentView: ViewId;
  rows: NativeListRow[];
  total: number;
  offset: number;
  listVersion: number;
  loading: boolean;
  error: string | null;
  currentPage: number;
  selectedIndex: number;
  currentDomain: string | null;
  navigationHistory: NavigationHistory | null;
  recentlyClosedRows: RecentlyClosedRow[];
  workspaceRows: WorkspaceRow[];
  containerRows: ContainerRow[];
  folderRows: FolderRow[];
  folderWorkspaces: WorkspaceRow[];
  profileRows: ProfileRow[];
  duplicateGroups: DuplicateGroupRow[];
  duplicateWorkspaces: WorkspaceRow[];
  tabInfo: TabInfo | null;
  tabInfoVisits: HistoryVisit[];
  tabInfoDuplicates: TabIndexRow[];
  tabInfoWorkspaces: WorkspaceRow[];
  duplicatePromptUrl: string;
  duplicatePromptDomId: string | null;
  duplicatePromptGroup: DuplicateGroupRow | null;
  duplicatePromptWorkspaces: WorkspaceRow[];
  domainsSortAlpha: boolean;
  tabsByAgeNewestFirst: boolean;
  sidebarWorkspaces: WorkspaceRow[];
  workspaceFilter: string;
  actionsWorkspaces: WorkspaceRow[];
  actionWorkspaceTabCounts: Record<string, number>;
  actionCounts: Record<string, number>;
  actionPreviewsById: Record<string, ActionPreview | null>;
  disabledActionIds: Set<string>;
  actionIconHtmlById: Record<string, string | null>;
  actionExtensions: ExtensionRow[];
};

function defaultNativePaletteState(): NativePaletteState {
  return {
    currentView: "actions",
    rows: [],
    total: 0,
    offset: 0,
    listVersion: 0,
    loading: false,
    error: null,
    currentPage: 1,
    selectedIndex: -1,
    currentDomain: null,
    navigationHistory: null,
    recentlyClosedRows: [],
    workspaceRows: [],
    containerRows: [],
    folderRows: [],
    folderWorkspaces: [],
    profileRows: [],
    duplicateGroups: [],
    duplicateWorkspaces: [],
    tabInfo: null,
    tabInfoVisits: [],
    tabInfoDuplicates: [],
    tabInfoWorkspaces: [],
    duplicatePromptUrl: "",
    duplicatePromptDomId: null,
    duplicatePromptGroup: null,
    duplicatePromptWorkspaces: [],
    domainsSortAlpha: false,
    tabsByAgeNewestFirst: false,
    sidebarWorkspaces: [],
    workspaceFilter: "all",
    actionsWorkspaces: [],
    actionWorkspaceTabCounts: {},
    actionCounts: {},
    actionPreviewsById: {},
    disabledActionIds: new Set(),
    actionIconHtmlById: {},
    actionExtensions: [],
  };
}

export function createNativePaletteState() {
  const state = $state<NativePaletteState>(defaultNativePaletteState());

  function setCurrentView(view: ViewId) {
    state.currentView = view;
  }

  function setLoading(value: boolean) {
    state.loading = value;
  }

  function setError(message: string | null) {
    state.error = message;
  }

  function selectIndex(index: number) {
    state.selectedIndex = index;
  }

  function selectActionsPage(page: number) {
    state.currentPage = page;
    state.selectedIndex = -1;
  }

  function setWorkspaceFilter(filter: string) {
    state.workspaceFilter = filter;
  }

  function setCurrentDomain(domain: string | null) {
    state.currentDomain = domain;
  }

  function setSortState(next: { domainsSortAlpha: boolean; tabsByAgeNewestFirst: boolean }) {
    state.domainsSortAlpha = next.domainsSortAlpha;
    state.tabsByAgeNewestFirst = next.tabsByAgeNewestFirst;
  }

  function resetToActions() {
    const next = defaultNativePaletteState();
    Object.assign(state, next);
  }

  function clearLoadedViewData() {
    state.rows = [];
    state.total = 0;
    state.offset = 0;
    state.listVersion = 0;
    state.currentDomain = null;
    state.navigationHistory = null;
    state.recentlyClosedRows = [];
    state.workspaceRows = [];
    state.containerRows = [];
    state.folderRows = [];
    state.folderWorkspaces = [];
    state.profileRows = [];
    state.duplicateGroups = [];
    state.duplicateWorkspaces = [];
    state.tabInfo = null;
    state.tabInfoVisits = [];
    state.tabInfoDuplicates = [];
    state.tabInfoWorkspaces = [];
    state.duplicatePromptUrl = "";
    state.duplicatePromptDomId = null;
    state.duplicatePromptGroup = null;
    state.duplicatePromptWorkspaces = [];
    state.sidebarWorkspaces = [];
    state.selectedIndex = -1;
    state.error = null;
  }

  function enterActionsView() {
    clearLoadedViewData();
    state.currentView = "actions";
    state.currentPage = 1;
  }

  function enterPrefixView(view: ViewId) {
    state.currentView = view;
    state.selectedIndex = -1;
    state.error = null;
  }

  function enterDomainList(domain: string | null) {
    state.currentDomain = domain;
  }

  function applyActionsMenuData(data: ActionsMenuData) {
    state.actionsWorkspaces = data.workspaces;
    state.actionWorkspaceTabCounts = data.workspaceTabCounts;
    state.actionExtensions = data.extensions;
    state.actionIconHtmlById = data.iconHtmlById;
    state.actionPreviewsById = data.previewsById;
    state.actionCounts = data.counts;
    state.disabledActionIds = data.disabledIds;
  }

  function commitSidebarWorkspaces(workspaces: WorkspaceRow[]) {
    state.sidebarWorkspaces = workspaces;
    if (state.workspaceFilter !== "all" && !workspaces.some((workspace) => workspace.uuid === state.workspaceFilter)) {
      state.workspaceFilter = "all";
    }
  }

  function clearSidebarWorkspaces() {
    state.sidebarWorkspaces = [];
  }

  function beginListWindowLoad(offset: number) {
    state.offset = offset;
  }

  function commitListWindow(win: ViewWindow<NativeListRow>, resetSelection: boolean) {
    state.rows = win.rows;
    state.total = win.total;
    state.listVersion = win.version;
    if (resetSelection) state.selectedIndex = -1;
  }

  function failListWindow(message: string) {
    state.rows = [];
    state.total = 0;
    state.listVersion = 0;
    state.selectedIndex = -1;
    state.error = message;
  }

  function replaceListWindow(rows: NativeListRow[], total: number, selectedIndex: number) {
    state.rows = rows;
    state.total = total;
    state.listVersion = 0;
    state.selectedIndex = selectedIndex;
  }

  function commitNavigation(result: { history: NavigationHistory | null; selectedIndex: number }) {
    state.navigationHistory = result.history;
    state.selectedIndex = result.selectedIndex;
  }

  function failNavigation(message: string) {
    state.navigationHistory = null;
    state.selectedIndex = -1;
    state.error = message;
  }

  function commitRecentlyClosed(result: { rows: RecentlyClosedRow[]; selectedIndex: number }) {
    state.recentlyClosedRows = result.rows;
    state.selectedIndex = result.selectedIndex;
  }

  function failRecentlyClosed(message: string) {
    state.recentlyClosedRows = [];
    state.selectedIndex = -1;
    state.error = message;
  }

  function commitMoveToWorkspace(result: { rows: WorkspaceRow[]; selectedIndex: number; version?: number }) {
    state.workspaceRows = result.rows;
    state.selectedIndex = result.selectedIndex;
    state.listVersion = result.version || 0;
  }

  function failMoveToWorkspace(message: string) {
    state.workspaceRows = [];
    state.selectedIndex = -1;
    state.error = message;
  }

  function commitOpenInContainer(result: { rows: ContainerRow[]; selectedIndex: number; version?: number }) {
    state.containerRows = result.rows;
    state.selectedIndex = result.selectedIndex;
    state.listVersion = result.version || 0;
  }

  function failOpenInContainer(message: string) {
    state.containerRows = [];
    state.selectedIndex = -1;
    state.error = message;
  }

  function commitMoveToFolder(result: { folders: FolderRow[]; workspaces: WorkspaceRow[]; selectedIndex: number; version?: number }) {
    state.folderRows = result.folders;
    state.folderWorkspaces = result.workspaces;
    state.selectedIndex = result.selectedIndex;
    state.listVersion = result.version || 0;
  }

  function failMoveToFolder(message: string) {
    state.folderRows = [];
    state.folderWorkspaces = [];
    state.selectedIndex = -1;
    state.error = message;
  }

  function commitProfiles(result: { rows: ProfileRow[]; selectedIndex: number; version?: number }) {
    state.profileRows = result.rows;
    state.selectedIndex = result.selectedIndex;
    state.listVersion = result.version || 0;
  }

  function failProfiles(message: string) {
    state.profileRows = [];
    state.selectedIndex = -1;
    state.error = message;
  }

  function commitDuplicates(result: {
    groups: DuplicateGroupRow[];
    workspaces: WorkspaceRow[];
    workspaceFilter: string;
    selectedIndex: number;
  }) {
    state.sidebarWorkspaces = result.workspaces;
    state.duplicateWorkspaces = result.workspaces;
    state.workspaceFilter = result.workspaceFilter;
    state.duplicateGroups = result.groups;
    state.selectedIndex = result.selectedIndex;
  }

  function failDuplicates(message: string) {
    state.duplicateGroups = [];
    state.duplicateWorkspaces = [];
    state.selectedIndex = -1;
    state.error = message;
  }

  function replaceDuplicateGroups(groups: DuplicateGroupRow[]) {
    state.duplicateGroups = groups;
  }

  function commitTabInfo(result: {
    info: TabInfo | null;
    visits: HistoryVisit[];
    duplicates: TabIndexRow[];
    workspaces: WorkspaceRow[];
    selectedIndex: number;
  }) {
    state.tabInfo = result.info;
    state.tabInfoVisits = result.visits;
    state.tabInfoDuplicates = result.duplicates;
    state.tabInfoWorkspaces = result.workspaces;
    state.selectedIndex = result.selectedIndex;
  }

  function failTabInfo(message: string) {
    state.tabInfo = null;
    state.tabInfoVisits = [];
    state.tabInfoDuplicates = [];
    state.tabInfoWorkspaces = [];
    state.selectedIndex = -1;
    state.error = message;
  }

  function replaceTabInfoDuplicates(rows: TabIndexRow[]) {
    state.tabInfoDuplicates = rows;
  }

  function commitDuplicatePrompt(result: DuplicatePromptData) {
    state.duplicatePromptUrl = result.url;
    state.duplicatePromptDomId = result.domId;
    state.duplicatePromptGroup = result.group;
    state.duplicatePromptWorkspaces = result.workspaces;
    state.selectedIndex = result.selectedIndex;
    state.listVersion = result.version || 0;
  }

  function failDuplicatePrompt(message: string) {
    state.duplicatePromptUrl = "";
    state.duplicatePromptDomId = null;
    state.duplicatePromptGroup = null;
    state.duplicatePromptWorkspaces = [];
    state.selectedIndex = -1;
    state.error = message;
  }

  function replaceDuplicatePromptGroup(group: DuplicateGroupRow | null) {
    state.duplicatePromptGroup = group;
  }

  return {
    state,
    setCurrentView,
    setLoading,
    setError,
    selectIndex,
    selectActionsPage,
    setWorkspaceFilter,
    setCurrentDomain,
    setSortState,
    resetToActions,
    clearLoadedViewData,
    enterActionsView,
    enterPrefixView,
    enterDomainList,
    applyActionsMenuData,
    commitSidebarWorkspaces,
    clearSidebarWorkspaces,
    beginListWindowLoad,
    commitListWindow,
    failListWindow,
    replaceListWindow,
    commitNavigation,
    failNavigation,
    commitRecentlyClosed,
    failRecentlyClosed,
    commitMoveToWorkspace,
    failMoveToWorkspace,
    commitOpenInContainer,
    failOpenInContainer,
    commitMoveToFolder,
    failMoveToFolder,
    commitProfiles,
    failProfiles,
    commitDuplicates,
    failDuplicates,
    replaceDuplicateGroups,
    commitTabInfo,
    failTabInfo,
    replaceTabInfoDuplicates,
    replaceDuplicatePromptGroup,
    commitDuplicatePrompt,
    failDuplicatePrompt,
  };
}
