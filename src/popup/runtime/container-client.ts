import { sendMessage } from "./ipc";

export type ContainerRow = {
  cookieStoreId: string;
  userContextId: number;
  name: string;
  colorCode: string;
  iconUrl: string;
};

export type ContainersViewModel = {
  version: number;
  view: "open-in-container";
  rows: ContainerRow[];
  selectedIndex: number;
  model: {
    id: "containers";
    view: "open-in-container";
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
  iconUrl?: string;
};

type BrowserWithContainers = {
  getContainers?: () => Promise<ContextualIdentity[]>;
  getContainersViewModel?: () => Promise<ContainersViewModel>;
};

function userContextIdFromCookieStore(cookieStoreId: string) {
  const match = /^firefox-container-(\d+)$/.exec(cookieStoreId);
  return match ? Number(match[1]) : 0;
}

export function normalizeContainer(row: ContextualIdentity): ContainerRow {
  const cookieStoreId = row.cookieStoreId || "";
  return {
    cookieStoreId,
    userContextId: Number(row.userContextId) || userContextIdFromCookieStore(cookieStoreId),
    name: row.name || "",
    colorCode: row.colorCode || "currentColor",
    iconUrl: row.iconUrl || "",
  };
}

export function createContainerClient(root: BrowserWithContainers | null = null) {
  return {
    async getContainers() {
      const rows = root?.getContainers
        ? await root.getContainers()
        : await sendMessage<ContextualIdentity[]>({ type: "get-containers" });
      return rows.map(normalizeContainer);
    },
    async getContainersViewModel() {
      if (root?.getContainersViewModel) return root.getContainersViewModel();
      return sendMessage<ContainersViewModel>({ type: "get-containers-view-model" });
    },
  };
}
