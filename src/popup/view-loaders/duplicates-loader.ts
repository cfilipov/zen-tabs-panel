import type { DuplicateGroupRow, DuplicateGroupsViewModel } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";

export type DuplicateGroupsClient = {
  getDuplicateGroups(params?: Record<string, unknown>): Promise<DuplicateGroupRow[]>;
  getDuplicateGroupsViewModel?(workspaceFilter?: string): Promise<DuplicateGroupsViewModel>;
};

export type DuplicateWorkspaceClient = {
  getWorkspacesWithIcons(): Promise<WorkspaceRow[]>;
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
  workspaceClient: DuplicateWorkspaceClient,
  workspaceFilter: string,
): Promise<DuplicateGroupsViewData> {
  if (tabIndexClient.getDuplicateGroupsViewModel) {
    return tabIndexClient.getDuplicateGroupsViewModel(workspaceFilter);
  }
  const workspaces = await workspaceClient.getWorkspacesWithIcons().catch(() => []);
  const nextWorkspaceFilter = workspaceFilter !== "all" && !workspaces.some((workspace) => workspace.uuid === workspaceFilter)
    ? "all"
    : workspaceFilter;
  const params = nextWorkspaceFilter === "all" ? {} : { workspaceId: nextWorkspaceFilter };

  return {
    groups: await tabIndexClient.getDuplicateGroups(params),
    workspaces,
    workspaceFilter: nextWorkspaceFilter,
    selectedIndex: -1,
  };
}
