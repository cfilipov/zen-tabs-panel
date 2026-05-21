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

export async function loadMoveToWorkspaceView(workspaceClient: WorkspaceClient) {
  if (workspaceClient.getWorkspacesViewModel) {
    return workspaceClient.getWorkspacesViewModel();
  }
  return {
    rows: await workspaceClient.getWorkspacesWithIcons(),
    selectedIndex: -1,
  };
}

export async function loadOpenInContainerView(containerClient: ContainerClient) {
  if (containerClient.getContainersViewModel) {
    return containerClient.getContainersViewModel();
  }
  return {
    rows: await containerClient.getContainers(),
    selectedIndex: -1,
  };
}

export async function loadMoveToFolderView(folderClient: FolderClient, workspaceClient: WorkspaceClient) {
  const [folderResult, workspaces] = await Promise.all([
    folderClient.getFoldersViewModel ? folderClient.getFoldersViewModel() : folderClient.getFolders(),
    workspaceClient.getWorkspacesWithIcons().catch(() => []),
  ]);
  const folderModel = Array.isArray(folderResult) ? null : folderResult;
  return {
    folders: folderModel ? folderModel.rows : folderResult,
    workspaces,
    selectedIndex: folderModel ? folderModel.selectedIndex : -1,
    version: folderModel ? folderModel.version : undefined,
    model: folderModel ? folderModel.model : undefined,
  };
}

export async function loadProfilesView(profileClient: ProfileClient) {
  if (profileClient.getProfilesViewModel) {
    return profileClient.getProfilesViewModel();
  }
  return {
    rows: await profileClient.getProfiles(),
    selectedIndex: -1,
  };
}
