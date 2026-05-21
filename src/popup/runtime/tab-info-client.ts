import { sendMessage } from "./ipc";
import type { TabIndexRow } from "./tab-index-client";
import type { WorkspaceRow } from "./workspace-client";

export type HistoryVisit = {
  visitTime: number;
  transition?: string;
  url?: string;
  title?: string;
};

export type SessionEntry = {
  url: string;
  title: string;
};

export type PanelStats = {
  createdAt?: number;
  focusCount?: number;
  focusDurationSeconds?: number;
  openerType?: "tab" | "bookmark" | "history" | "external" | "manual" | string;
};

export type TabInfo = {
  domId: string;
  title: string;
  url: string;
  favIconUrl: string;
  pinned: boolean;
  workspaceId: string | null;
  lastAccessed: number;
  status: string;
  sessionEntries: SessionEntry[];
  memory: number | null;
  cpuTime: number | null;
  duplicateDomIds: string[];
  panelTabUuid: string | null;
  panelParentUuid: string | null;
  panelStats: PanelStats | null;
  parentTitle: string | null;
  parentDomId: string | null;
  parentFavIconUrl: string | null;
};

export type TabInfoViewModel = {
  info: TabInfo | null;
  visits: HistoryVisit[];
  duplicates: TabIndexRow[];
  workspaces: WorkspaceRow[];
  selectedIndex: number;
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

export function createTabInfoClient(send: Send = sendMessage) {
  return {
    getTabInfo(domId: string) {
      return send<TabInfo | null>({ type: "get-tab-info", domId });
    },
    getHistoryVisits(url: string) {
      return send<HistoryVisit[]>({ type: "get-history-visits", url });
    },
    getTabInfoViewModel() {
      return send<TabInfoViewModel>({ type: "get-tab-info-view-model" });
    },
  };
}
