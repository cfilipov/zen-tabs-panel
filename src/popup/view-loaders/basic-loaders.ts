import type { ContainerRow } from "../runtime/container-client";
import type { FolderRow } from "../runtime/folder-client";
import type { NavigationHistory, RecentlyClosedRow } from "../runtime/history-client";
import type { ProfileRow } from "../runtime/profile-client";
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
};

export type FolderClient = {
  getFolders(): Promise<FolderRow[]>;
};

export type ProfileClient = {
  getProfiles(): Promise<ProfileRow[]>;
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
  return {
    rows: await containerClient.getContainers(),
    selectedIndex: -1,
  };
}

export async function loadMoveToFolderView(folderClient: FolderClient, workspaceClient: WorkspaceClient) {
  const [folders, workspaces] = await Promise.all([
    folderClient.getFolders(),
    workspaceClient.getWorkspacesWithIcons().catch(() => []),
  ]);
  return {
    folders,
    workspaces,
    selectedIndex: -1,
  };
}

export async function loadProfilesView(profileClient: ProfileClient) {
  return {
    rows: await profileClient.getProfiles(),
    selectedIndex: -1,
  };
}
