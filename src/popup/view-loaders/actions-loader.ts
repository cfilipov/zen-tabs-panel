import type { ActionPreview, ActionsViewModel } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";
import type { ExtensionRow } from "../runtime/extension-client";
import type { ActionSection } from "../views/actions-model";

export type ActionsTabIndexClient = {
  getActionsViewModel(): Promise<ActionsViewModel>;
};

export type LoadActionsDeps = {
  tabIndexClient: ActionsTabIndexClient;
};

export type ActionsMenuData = {
  sections?: ActionSection[];
  workspaces: WorkspaceRow[];
  workspaceTabCounts: Record<string, number>;
  extensions: ExtensionRow[];
  iconHtmlById: Record<string, string | null>;
  previewsById: Record<string, ActionPreview | null>;
  counts: Record<string, number>;
  disabledIds: Set<string>;
};

export function emptyActionsMenuData(): ActionsMenuData {
  return {
    sections: [],
    workspaces: [],
    workspaceTabCounts: {},
    extensions: [],
    iconHtmlById: {},
    previewsById: {},
    counts: {},
    disabledIds: new Set(),
  };
}

export async function loadActionsMenuData(deps: LoadActionsDeps): Promise<ActionsMenuData> {
  const model = await deps.tabIndexClient.getActionsViewModel();
  return {
    sections: model.sections,
    workspaces: model.workspaces,
    workspaceTabCounts: model.workspaceTabCounts,
    extensions: model.extensions,
    iconHtmlById: model.iconHtmlById,
    previewsById: model.previewsById,
    counts: model.counts,
    disabledIds: new Set(model.disabledIds),
  };
}
