import type { ViewId } from "../../shared/types";
import type { ActionMenuItem } from "../views/actions-model";

export type ActionItemActivation =
  | { kind: "none" }
  | { kind: "fire-action"; actionId: string }
  | { kind: "open-view"; view: ViewId }
  | { kind: "switch-workspace"; workspaceId: string };

export function resolveActionItemActivation(item: ActionMenuItem): ActionItemActivation {
  if (item.disabled) return { kind: "none" };
  if (item.kind === "workspace-switch") {
    return item.workspaceId
      ? { kind: "switch-workspace", workspaceId: item.workspaceId }
      : { kind: "none" };
  }
  if (item.kind === "action") return { kind: "fire-action", actionId: item.id };
  if (item.view) return { kind: "open-view", view: item.view as ViewId };
  return { kind: "none" };
}
