import type { DuplicateGroupRow, DuplicateGroupsViewModel } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";

export type DuplicateGroupsClient = {
  getDuplicateGroupsViewModel(workspaceFilter?: string): Promise<DuplicateGroupsViewModel>;
};

export type DuplicateGroupsViewData = {
  groups: DuplicateGroupRow[];
  workspaces: WorkspaceRow[];
  workspaceFilter: string;
  selectedIndex: number;
  version?: number;
  model?: DuplicateGroupsViewModel["model"];
};

export async function loadDuplicateGroupsView(
  tabIndexClient: DuplicateGroupsClient,
  _workspaceClient: unknown,
  workspaceFilter: string,
): Promise<DuplicateGroupsViewData> {
  return tabIndexClient.getDuplicateGroupsViewModel(workspaceFilter);
}
