import type { ViewId } from "../../shared/types";
import type { ContainerRow } from "../runtime/container-client";
import type { ExtensionRow } from "../runtime/extension-client";
import type { FolderRow } from "../runtime/folder-client";
import type { NavigationHistory, RecentlyClosedRow } from "../runtime/history-client";
import type { ProfileRow } from "../runtime/profile-client";
import type { HistoryVisit, TabInfo } from "../runtime/tab-info-client";
import type { ActionPreview, DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";
import type { NativeListRow } from "../view-loaders/list-loader";

export type NativePaletteState = {
  currentView: ViewId;
  rows: NativeListRow[];
  total: number;
  offset: number;
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

  function resetToActions() {
    const next = defaultNativePaletteState();
    Object.assign(state, next);
  }

  function clearLoadedViewData() {
    state.rows = [];
    state.total = 0;
    state.offset = 0;
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
    state.sidebarWorkspaces = [];
    state.selectedIndex = -1;
    state.error = null;
  }

  return {
    state,
    resetToActions,
    clearLoadedViewData,
  };
}
