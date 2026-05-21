import type { DuplicateGroupRow, DuplicatePromptViewModel } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";

export type DuplicatePromptData = {
  url: string;
  domId: string | null;
  group: DuplicateGroupRow | null;
  workspaces: WorkspaceRow[];
  selectedIndex: number;
  version?: number;
  model?: DuplicatePromptViewModel["model"];
};

export type DuplicatePromptParams = URLSearchParams | Record<string, unknown>;

export type DuplicatePromptTabIndexClient = {
  getDuplicatePromptViewModel(url: string, domId?: string | null): Promise<DuplicatePromptViewModel>;
};

export type DuplicatePromptWorkspaceClient = {
  getWorkspacesWithIcons(): Promise<WorkspaceRow[]>;
};

function paramValue(params: DuplicatePromptParams, key: "url" | "domId") {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  return typeof value === "string" ? value : null;
}

export async function loadDuplicatePromptView(
  tabIndexClient: DuplicatePromptTabIndexClient,
  workspaceClient: DuplicatePromptWorkspaceClient,
  params: DuplicatePromptParams,
): Promise<DuplicatePromptData> {
  const url = paramValue(params, "url") || "";
  const domId = paramValue(params, "domId");
  const [model, workspaces] = await Promise.all([
    tabIndexClient.getDuplicatePromptViewModel(url, domId),
    workspaceClient.getWorkspacesWithIcons().catch(() => []),
  ]);

  return {
    url: model.url,
    domId: model.domId,
    group: model.group,
    workspaces,
    selectedIndex: model.selectedIndex,
    version: model.version,
    model: model.model,
  };
}
