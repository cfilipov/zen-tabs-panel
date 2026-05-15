import type { DuplicateGroupRow } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";

export type DuplicateGroupsClient = {
  getDuplicateGroups(params?: Record<string, unknown>): Promise<DuplicateGroupRow[]>;
};

export type DuplicateWorkspaceClient = {
  getWorkspacesWithIcons(): Promise<WorkspaceRow[]>;
};

export async function loadDuplicateGroupsView(
  tabIndexClient: DuplicateGroupsClient,
  workspaceClient: DuplicateWorkspaceClient,
  workspaceFilter: string,
) {
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
