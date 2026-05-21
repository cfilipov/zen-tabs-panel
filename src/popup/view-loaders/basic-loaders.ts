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
  getWorkspacesWithIcons(): Promise<WorkspaceRow[]>;
  getWorkspacesViewModel?(): Promise<WorkspacesViewModel>;
};

export type ContainerClient = {
  getContainers(): Promise<ContainerRow[]>;
  getContainersViewModel?(): Promise<ContainersViewModel>;
};

export type FolderClient = {
  getFolders(): Promise<FolderRow[]>;
  getFoldersViewModel?(): Promise<FoldersViewModel>;
};

export type ProfileClient = {
  getProfiles(): Promise<ProfileRow[]>;
  getProfilesViewModel?(): Promise<ProfilesViewModel>;
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
  if (workspaceClient.getWorkspacesViewModel) {
    return workspaceClient.getWorkspacesViewModel();
  }
  return {
    rows: await workspaceClient.getWorkspacesWithIcons(),
    selectedIndex: -1,
  };
}

export async function loadOpenInContainerView(containerClient: ContainerClient): Promise<OpenInContainerViewData> {
  if (containerClient.getContainersViewModel) {
    return containerClient.getContainersViewModel();
  }
  return {
    rows: await containerClient.getContainers(),
    selectedIndex: -1,
  };
}

export async function loadMoveToFolderView(folderClient: FolderClient, workspaceClient: WorkspaceClient): Promise<MoveToFolderViewData> {
  const [folderResult, workspaces] = await Promise.all([
    folderClient.getFoldersViewModel ? folderClient.getFoldersViewModel() : folderClient.getFolders(),
    workspaceClient.getWorkspacesWithIcons().catch(() => []),
  ]);
  const folderModel = Array.isArray(folderResult) ? null : folderResult;
  const folders = Array.isArray(folderResult) ? folderResult : folderResult.rows;
  return {
    folders,
    workspaces,
    selectedIndex: folderModel ? folderModel.selectedIndex : -1,
    version: folderModel ? folderModel.version : undefined,
    model: folderModel ? folderModel.model : undefined,
  };
}

export async function loadProfilesView(profileClient: ProfileClient): Promise<ProfilesViewData> {
  if (profileClient.getProfilesViewModel) {
    return profileClient.getProfilesViewModel();
  }
  return {
    rows: await profileClient.getProfiles(),
    selectedIndex: -1,
  };
}
