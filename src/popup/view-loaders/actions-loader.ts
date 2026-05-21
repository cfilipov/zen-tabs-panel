import type { ActionsViewModel } from "../runtime/tab-index-client";
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
  prefixItemsByView?: Partial<Record<string, ActionSection["items"]>>;
  workspaces: WorkspaceRow[];
  extensions: ExtensionRow[];
};

export function emptyActionsMenuData(): ActionsMenuData {
  return {
    sections: [],
    prefixItemsByView: {},
    workspaces: [],
    extensions: [],
  };
}

export async function loadActionsMenuData(deps: LoadActionsDeps): Promise<ActionsMenuData> {
  const model = await deps.tabIndexClient.getActionsViewModel();
  return {
    sections: model.sections,
    prefixItemsByView: model.prefixItemsByView || {},
    workspaces: model.workspaces,
    extensions: model.extensions,
  };
}
