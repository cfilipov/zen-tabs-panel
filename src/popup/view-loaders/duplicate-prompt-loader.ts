import type { DuplicateGroupRow } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";

export type DuplicatePromptData = {
  url: string;
  domId: string | null;
  group: DuplicateGroupRow | null;
  workspaces: WorkspaceRow[];
  selectedIndex: number;
};

export type DuplicatePromptParams = URLSearchParams | Record<string, unknown>;

export type DuplicatePromptTabIndexClient = {
  getDuplicateGroups(params?: Record<string, unknown>): Promise<DuplicateGroupRow[]>;
};

export type DuplicatePromptWorkspaceClient = {
  getWorkspacesWithIcons(): Promise<WorkspaceRow[]>;
};

function paramValue(params: DuplicatePromptParams, key: "url" | "domId") {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function prioritizeExistingTab(group: DuplicateGroupRow | null, domId: string | null) {
  if (!group || !domId) return group;
  const existingIndex = group.tabs.findIndex((tab) => tab.domId === domId);
  if (existingIndex <= 0) return group;
  const tabs = group.tabs.slice();
  const [existing] = tabs.splice(existingIndex, 1);
  tabs.unshift(existing);
  return { ...group, tabs };
}

export async function loadDuplicatePromptView(
  tabIndexClient: DuplicatePromptTabIndexClient,
  workspaceClient: DuplicatePromptWorkspaceClient,
  params: DuplicatePromptParams,
): Promise<DuplicatePromptData> {
  const url = paramValue(params, "url") || "";
  const domId = paramValue(params, "domId");
  const [groups, workspaces] = await Promise.all([
    url ? tabIndexClient.getDuplicateGroups({ url, includeSingleton: true }).catch(() => []) : Promise.resolve([]),
    workspaceClient.getWorkspacesWithIcons().catch(() => []),
  ]);

  return {
    url,
    domId,
    group: prioritizeExistingTab(groups[0] ?? null, domId),
    workspaces,
    selectedIndex: -1,
  };
}
