export type ContainerRow = {
  cookieStoreId: string;
  userContextId: number;
  name: string;
  colorCode: string;
  iconUrl: string;
};

type ContextualIdentity = {
  cookieStoreId?: string;
  name?: string;
  colorCode?: string;
  iconUrl?: string;
};

type BrowserWithContainers = {
  contextualIdentities?: {
    query(details: Record<string, never>): Promise<ContextualIdentity[]>;
  };
};

function userContextIdFromCookieStore(cookieStoreId: string) {
  const match = /^firefox-container-(\d+)$/.exec(cookieStoreId);
  return match ? Number(match[1]) : 0;
}

export function normalizeContainer(row: ContextualIdentity): ContainerRow {
  const cookieStoreId = row.cookieStoreId || "";
  return {
    cookieStoreId,
    userContextId: userContextIdFromCookieStore(cookieStoreId),
    name: row.name || "",
    colorCode: row.colorCode || "currentColor",
    iconUrl: row.iconUrl || "",
  };
}

export function createContainerClient(root: BrowserWithContainers | null = null) {
  const globals = globalThis as typeof globalThis & {
    browser?: BrowserWithContainers;
    chrome?: BrowserWithContainers;
  };
  const api = root ?? globals.browser ?? globals.chrome ?? null;
  return {
    async getContainers() {
      const rows = await api?.contextualIdentities?.query({}) ?? [];
      return rows.map(normalizeContainer);
    },
  };
}
