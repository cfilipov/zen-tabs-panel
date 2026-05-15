import { sendMessage } from "./ipc";

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
  id: number | null;
  domId: string;
  title: string;
  url: string;
  domain: string;
  workspaceId: string | null;
  pinned: boolean;
  essential: boolean;
  active: boolean;
  lastAccessed: number;
  favIconUrl: string;
  unread: boolean;
  openerTabDomId: string | null;
  splitView: boolean;
  splitGroupId: string | null;
  pending: boolean;
  panelTabUuid: string | null;
  panelParentUuid: string | null;
  focusCount?: number;
};

export type DomainIndexRow = {
  kind: "domain";
  domain: string;
  count: number;
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
  getRowTarget(domId: string): Promise<{ domId: string; workspaceId: string | null; url: string; title: string } | null>;
};

type BrowserWithExperiment = {
  zenWorkspaces?: ZenWorkspacesApi;
};

function getDirectApi(): ZenWorkspacesApi | null {
  const globals = globalThis as typeof globalThis & {
    browser?: BrowserWithExperiment;
    chrome?: BrowserWithExperiment;
  };
  if (globals.browser?.zenWorkspaces) return globals.browser.zenWorkspaces;
  if (globals.chrome?.zenWorkspaces) return globals.chrome.zenWorkspaces;
  return null;
}

function encodeParams(params: Record<string, unknown>) {
  return JSON.stringify(params || {});
}

export function createTabIndexClient(send: Send = sendMessage, directApi: ZenWorkspacesApi | null = getDirectApi()) {
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
    getRowTarget(domId: string) {
      if (directApi) return directApi.getRowTarget(domId);
      return send<{ domId: string; workspaceId: string | null; url: string; title: string } | null>({
        type: "tab-index:get-row-target",
        domId,
      });
    },
  };
}
