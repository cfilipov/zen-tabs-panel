import type { ContainerRow, ContainersViewModel } from "../runtime/container-client";
import type { FolderRow, FoldersViewModel } from "../runtime/folder-client";
import type { NavigationHistory, RecentlyClosedRow } from "../runtime/history-client";
import type { ProfileRow, ProfilesViewModel } from "../runtime/profile-client";
import type { WorkspaceRow, WorkspacesViewModel } from "../runtime/workspace-client";
import { filterNavigationHistory } from "./navigation-history";

export type HistoryClient = {
  getNavigationHistory(): Promise<NavigationHistory | null>;
  getRecentlyClosed(): Promise<RecentlyClosedRow[]>;
};

export type WorkspaceClient = {
  getWorkspacesViewModel(): Promise<WorkspacesViewModel>;
};

export type ContainerClient = {
  getContainersViewModel(): Promise<ContainersViewModel>;
};

export type FolderClient = {
  getFoldersViewModel(): Promise<FoldersViewModel>;
};

export type ProfileClient = {
  getProfilesViewModel(): Promise<ProfilesViewModel>;
};

export type FolderWorkspaceClient = {
  getWorkspacesWithIcons(): Promise<WorkspaceRow[]>;
};

export type MoveToWorkspaceViewData = {
  rows: WorkspaceRow[];
  selectedIndex: number;
  version?: number;
  model?: WorkspacesViewModel["model"];
};

export type OpenInContainerViewData = {
  rows: ContainerRow[];
  selectedIndex: number;
  version?: number;
  model?: ContainersViewModel["model"];
};

export type MoveToFolderViewData = {
  folders: FolderRow[];
  workspaces: WorkspaceRow[];
  selectedIndex: number;
  version?: number;
  model?: FoldersViewModel["model"];
};

export type ProfilesViewData = {
  rows: ProfileRow[];
  selectedIndex: number;
  version?: number;
  model?: ProfilesViewModel["model"];
};

export async function loadNavigationView(historyClient: HistoryClient) {
  const history = filterNavigationHistory(await historyClient.getNavigationHistory());
  return {
    history,
    selectedIndex: history?.entries.length && history.index >= 0 ? history.index : -1,
  };
}

export async function loadRecentlyClosedView(historyClient: HistoryClient) {
  return {
    rows: await historyClient.getRecentlyClosed(),
    selectedIndex: -1,
  };
}

export async function loadMoveToWorkspaceView(workspaceClient: WorkspaceClient): Promise<MoveToWorkspaceViewData> {
  return workspaceClient.getWorkspacesViewModel();
}

export async function loadOpenInContainerView(containerClient: ContainerClient): Promise<OpenInContainerViewData> {
  return containerClient.getContainersViewModel();
}

export async function loadMoveToFolderView(folderClient: FolderClient, workspaceClient: FolderWorkspaceClient): Promise<MoveToFolderViewData> {
  const [folderResult, workspaces] = await Promise.all([
    folderClient.getFoldersViewModel(),
    workspaceClient.getWorkspacesWithIcons().catch(() => []),
  ]);
  return {
    folders: folderResult.rows,
    workspaces,
    selectedIndex: folderResult.selectedIndex,
    version: folderResult.version,
    model: folderResult.model,
  };
}

export async function loadProfilesView(profileClient: ProfileClient): Promise<ProfilesViewData> {
  return profileClient.getProfilesViewModel();
}
