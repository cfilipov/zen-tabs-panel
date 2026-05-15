import { sendMessage } from "./ipc";

export type TabIndexView = "last-visited" | "unvisited-tabs" | "domain-tabs" | "tabs-by-age" | "domains" | "all";

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

export function createTabIndexClient(send: Send = sendMessage) {
  return {
    ensureStarted() {
      return send<boolean>({ type: "tab-index:ensure-started" });
    },
    getSummary(view: TabIndexView, params: Record<string, unknown> = {}) {
      return send<ViewSummary>({ type: "tab-index:get-summary", view, params });
    },
    getWindow<T = TabIndexRow | DomainIndexRow>(
      view: TabIndexView,
      offset: number,
      limit: number,
      params: Record<string, unknown> = {},
    ) {
      return send<ViewWindow<T>>({ type: "tab-index:get-window", view, offset, limit, params });
    },
    getRowTarget(domId: string) {
      return send<{ domId: string; workspaceId: string | null; url: string; title: string } | null>({
        type: "tab-index:get-row-target",
        domId,
      });
    },
  };
}
