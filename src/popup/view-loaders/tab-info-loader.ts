import type { HistoryVisit, TabInfo, TabInfoViewModel } from "../runtime/tab-info-client";
import type { TabIndexRow } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";

export type TabInfoClient = {
  getTabInfoViewModel(): Promise<TabInfoViewModel>;
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
  _tabIndexClient: unknown,
  tabInfoClient: TabInfoClient,
  _workspaceClient: unknown,
) {
  return tabInfoClient.getTabInfoViewModel();
}
