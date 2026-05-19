import { sendMessage } from "./ipc";

export type NavigationEntry = {
  url: string;
  title: string;
  historyIndex?: number;
};

export type NavigationHistory = {
  entries: NavigationEntry[];
  index: number;
};

export type RecentlyClosedRow = {
  sessionId: string;
  title: string;
  url: string;
  favIconUrl: string;
  pinned: boolean;
  lastModified: number;
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

export function createHistoryClient(send: Send = sendMessage) {
  return {
    getNavigationHistory() {
      return send<NavigationHistory | null>({ type: "get-navigation-history" });
    },
    getRecentlyClosed() {
      return send<RecentlyClosedRow[]>({ type: "get-recently-closed" });
    },
  };
}
