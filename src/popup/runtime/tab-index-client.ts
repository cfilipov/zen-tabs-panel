import { sendMessage } from "./ipc";
import type { ViewId } from "../../shared/types";
import type { ActionSection } from "../views/actions-model";
import type { ExtensionRow } from "./extension-client";
import type { WorkspaceRow } from "./workspace-client";

export type TabIndexView =
  | "child-tabs"
  | "sibling-tabs"
  | "parent-tabs"
  | "last-visited"
  | "unvisited-tabs"
  | "domain-tabs"
  | "tabs-by-age"
  | "most-visited"
  | "domains"
  | "all";

export type TabIndexRow = {
  kind?: "tab";
  index: number;
  id?: number | null;
  domId: string;
  title: string;
  url?: string;
  domain: string;
  workspaceId: string | null;
  pinned: boolean;
  essential: boolean;
  active: boolean;
  lastAccessed?: number;
  favIconUrl: string;
  unread?: boolean;
  openerTabDomId?: string | null;
  splitView?: boolean;
  splitGroupId?: string | null;
  pending: boolean;
  panelTabUuid?: string | null;
  panelParentUuid?: string | null;
  focusCount?: number;
  childCount?: number;
};

export type DomainIndexRow = {
  kind: "domain";
  domain: string;
  count: number;
  closeableUnpinnedCount?: number;
  closeablePinnedCount?: number;
};

export type DuplicateGroupRow = {
  kind: "duplicate-group";
  url: string;
  title: string;
  domain: string;
  favIconUrl: string;
  tabs: TabIndexRow[];
};

export type DuplicatePromptViewModel = {
  version: number;
  view: "duplicate-prompt";
  url: string;
  domId: string | null;
  group: DuplicateGroupRow | null;
  selectedIndex: number;
  model: {
    id: "duplicate-prompt";
    view: "duplicate-prompt";
    rowIntents: Array<{
      rowId: string | null;
      index: number;
      chordKey: string | null;
      action: string;
    }>;
  };
};

export type DuplicateGroupsViewModel = {
  version: number;
  view: "duplicates";
  groups: DuplicateGroupRow[];
  workspaces: WorkspaceRow[];
  workspaceFilter: string;
  selectedIndex: number;
  model: {
    id: "duplicates";
    view: "duplicates";
    rowIntents: Array<{
      rowId: string | null;
      index: number;
      chordKey: string | null;
      action: string;
    }>;
  };
};

export type ViewSummary = {
  version: number;
  view: string;
  total: number;
  rowType: "tab" | "domain";
};

export type ViewWindow<T = TabIndexRow | DomainIndexRow> = {
  version: number;
  view: string;
  offset: number;
  limit: number;
  total: number;
  rows: T[];
  favicons?: Record<string, string>;
  model?: RowIntentModel;
};

export type RowIntentModel = {
  id: string;
  view: string;
  version?: number;
  rowIntents: Array<{
    rowId: string | null;
    index: number;
    chordKey: string | null;
    action: string;
  }>;
};

export type RecentsViewModel = ViewWindow<TabIndexRow> & {
  model: RowIntentModel;
};

export type ActionPreview = {
  title: string;
  url?: string;
  favIconUrl?: string;
  domId?: string;
  workspaceId?: string | null;
  pending?: boolean;
  pinned?: boolean;
  essential?: boolean;
  isHistory?: boolean;
};

export type ActionsViewModel = {
  version: number;
  view: "actions";
  sections: ActionSection[];
  prefixItemsByView: Partial<Record<ViewId, ActionSection["items"]>>;
  workspaces: WorkspaceRow[];
  extensions: ExtensionRow[];
  selectedIndex: number;
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

type ZenWorkspacesApi = {
  ensureIndexStarted(): Promise<boolean>;
  getViewSummary(view: string, paramsJson?: string): Promise<ViewSummary>;
  getViewWindow<T = TabIndexRow | DomainIndexRow>(
    view: string,
    offset: number,
    limit: number,
    paramsJson?: string,
  ): Promise<ViewWindow<T>>;
  getRecentsViewModel?(offset: number, limit: number, paramsJson?: string): Promise<RecentsViewModel>;
  getRowTarget(domId: string): Promise<{ domId: string; workspaceId: string | null; url: string; title: string } | null>;
  getActiveRow(): Promise<TabIndexRow | null>;
  getRowsByDomIds(domIdsJson?: string): Promise<TabIndexRow[]>;
  getWorkspaceTabCounts(): Promise<Record<string, number>>;
  getActionsViewModel?(recentlyClosedCount?: number): Promise<ActionsViewModel>;
  getDuplicateGroupsViewModel?(workspaceFilter?: string): Promise<DuplicateGroupsViewModel>;
  getDuplicatePromptViewModel?(url: string, domId?: string | null): Promise<DuplicatePromptViewModel>;
};

function encodeParams(params: Record<string, unknown>) {
  return JSON.stringify(params || {});
}

export function createTabIndexClient(send: Send = sendMessage, directApi: ZenWorkspacesApi | null = null) {
  return {
    ensureStarted() {
      if (directApi) return directApi.ensureIndexStarted();
      return send<boolean>({ type: "tab-index:ensure-started" });
    },
    getSummary(view: TabIndexView, params: Record<string, unknown> = {}) {
      if (directApi) return directApi.getViewSummary(view, encodeParams(params));
      return send<ViewSummary>({ type: "tab-index:get-summary", view, params });
    },
    getWindow<T = TabIndexRow | DomainIndexRow>(
      view: TabIndexView,
      offset: number,
      limit: number,
      params: Record<string, unknown> = {},
    ) {
      if (directApi) return directApi.getViewWindow<T>(view, offset, limit, encodeParams(params));
      return send<ViewWindow<T>>({ type: "tab-index:get-window", view, offset, limit, params });
    },
    getRecentsViewModel(
      offset: number,
      limit: number,
      params: Record<string, unknown> = {},
    ) {
      if (directApi?.getRecentsViewModel) return directApi.getRecentsViewModel(offset, limit, encodeParams(params));
      if (directApi) return directApi.getViewWindow<TabIndexRow>("last-visited", offset, limit, encodeParams(params)) as Promise<RecentsViewModel>;
      return send<RecentsViewModel>({ type: "tab-index:get-recents-model", offset, limit, params });
    },
    getRowTarget(domId: string) {
      if (directApi) return directApi.getRowTarget(domId);
      return send<{ domId: string; workspaceId: string | null; url: string; title: string } | null>({
        type: "tab-index:get-row-target",
        domId,
      });
    },
    getActiveRow() {
      if (directApi) return directApi.getActiveRow();
      return send<TabIndexRow | null>({ type: "tab-index:get-active-row" });
    },
    getRowsByDomIds(domIds: string[]) {
      if (directApi) return directApi.getRowsByDomIds(JSON.stringify(domIds));
      return send<TabIndexRow[]>({ type: "tab-index:get-rows-by-dom-ids", domIds });
    },
    getWorkspaceTabCounts() {
      if (directApi) return directApi.getWorkspaceTabCounts();
      return send<Record<string, number>>({ type: "tab-index:get-workspace-counts" });
    },
    getActionsViewModel() {
      if (directApi?.getActionsViewModel) return directApi.getActionsViewModel();
      return send<ActionsViewModel>({ type: "tab-index:get-actions-model" });
    },
    getDuplicateGroupsViewModel(workspaceFilter = "all") {
      if (directApi?.getDuplicateGroupsViewModel) return directApi.getDuplicateGroupsViewModel(workspaceFilter);
      return send<DuplicateGroupsViewModel>({ type: "tab-index:get-duplicate-groups-model", workspaceFilter });
    },
    getDuplicatePromptViewModel(url: string, domId: string | null = null) {
      if (directApi?.getDuplicatePromptViewModel) return directApi.getDuplicatePromptViewModel(url, domId);
      return send<DuplicatePromptViewModel>({ type: "tab-index:get-duplicate-prompt-model", url, domId });
    },
  };
}
