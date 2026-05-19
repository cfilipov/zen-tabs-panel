import type { HistoryVisit, TabInfo } from "../runtime/tab-info-client";
import type { TabIndexRow } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";

export type TabInfoClient = {
  getTabInfo(domId: string): Promise<TabInfo | null>;
  getHistoryVisits(url: string): Promise<HistoryVisit[]>;
};

export type TabInfoIndexClient = {
  getActiveRow(): Promise<TabIndexRow | null>;
  getRowsByDomIds(domIds: string[]): Promise<TabIndexRow[]>;
};

export type TabInfoWorkspaceClient = {
  getWorkspacesWithIcons(): Promise<WorkspaceRow[]>;
};

export function emptyTabInfoView() {
  return {
    info: null as TabInfo | null,
    visits: [] as HistoryVisit[],
    duplicates: [] as TabIndexRow[],
    workspaces: [] as WorkspaceRow[],
    selectedIndex: -1,
  };
}

export async function loadTabInfoView(
  tabIndexClient: TabInfoIndexClient,
  tabInfoClient: TabInfoClient,
  workspaceClient: TabInfoWorkspaceClient,
) {
  const active = await tabIndexClient.getActiveRow();
  if (!active) return emptyTabInfoView();

  const info = await tabInfoClient.getTabInfo(active.domId);
  if (!info) return emptyTabInfoView();

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

  const [visitLists, workspaces, duplicates] = await Promise.all([
    Promise.all([...urls].map((url) => tabInfoClient.getHistoryVisits(url).then(
      (visits) => visits.map((visit) => ({ ...visit, url, title: titleByUrl.get(url) || url })),
      () => [],
    ))),
    workspaceClient.getWorkspacesWithIcons().catch(() => []),
    info.duplicateDomIds.length ? tabIndexClient.getRowsByDomIds(info.duplicateDomIds) : [],
  ]);

  return {
    info,
    visits: visitLists.flat(),
    duplicates,
    workspaces,
    selectedIndex: -1,
  };
}
