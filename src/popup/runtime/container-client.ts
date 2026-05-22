import { sendMessage } from "./ipc";

export type ContainerRow = {
  cookieStoreId: string;
  userContextId: number;
  name: string;
  colorCode: string;
  iconUrl: string;
  iconName?: string;
};

export type ContainersViewModel = {
  version: number;
  view: "open-in-container" | "workspace-profiles";
  rows: ContainerRow[];
  selectedIndex: number;
  model: {
    id: "containers" | "workspace-profiles";
    view: "open-in-container" | "workspace-profiles";
    rowIntents: Array<{
      rowId: string;
      index: number;
      chordKey: string | null;
      action: string;
    }>;
  };
};

type ContextualIdentity = {
  cookieStoreId?: string;
  userContextId?: number;
  name?: string;
  colorCode?: string;
  color?: string;
  iconUrl?: string;
  icon?: string;
};

type BrowserWithContainers = {
  getContainersViewModel?: () => Promise<ContainersViewModel>;
  getWorkspaceProfilesViewModel?: () => Promise<ContainersViewModel>;
};

function userContextIdFromCookieStore(cookieStoreId: string) {
  const match = /^firefox-container-(\d+)$/.exec(cookieStoreId);
  return match ? Number(match[1]) : 0;
}

export function normalizeContainer(row: ContextualIdentity): ContainerRow {
  const cookieStoreId = row.cookieStoreId || "";
  const userContextId = Number(row.userContextId) || userContextIdFromCookieStore(cookieStoreId);
  const iconName = row.icon || (row.iconUrl && !row.iconUrl.includes("/") ? row.iconUrl : "");
  return {
    cookieStoreId,
    userContextId,
    name: row.name || defaultContainerName(userContextId),
    colorCode: row.colorCode || row.color || "currentColor",
    iconUrl: normalizeContainerIconUrl(row.iconUrl || "", iconName),
    iconName,
  };
}

function defaultContainerName(userContextId: number) {
  return ({
    1: "Personal",
    2: "Work",
    3: "Banking",
    4: "Shopping",
  } as Record<number, string>)[userContextId] || "";
}

function normalizeContainerIconUrl(iconUrl: string, iconName = "") {
  if (iconUrl && iconUrl.includes("/")) return iconUrl;
  const name = iconName || iconUrl;
  return name ? `resource://usercontext-content/${name}.svg` : "";
}

export function createContainerClient(root: BrowserWithContainers | null = null) {
  return {
    async getContainersViewModel() {
      if (root?.getContainersViewModel) return root.getContainersViewModel();
      return sendMessage<ContainersViewModel>({ type: "get-containers-view-model" });
    },
    async getWorkspaceProfilesViewModel() {
      if (root?.getWorkspaceProfilesViewModel) return root.getWorkspaceProfilesViewModel();
      return sendMessage<ContainersViewModel>({ type: "get-workspace-profiles-view-model" });
    },
  };
}
