import type { ActionEffectId } from "../../shared/navigation-tree";
import type { ViewId } from "../../shared/types";
import type { ActionMenuItem } from "../views/actions-model";
import { isActionEffectId } from "./action-registry";

export type ActionItemActivation =
  | { kind: "none" }
  | { kind: "fire-action"; actionId: ActionEffectId }
  | { kind: "open-view"; view: ViewId }
  | { kind: "switch-workspace-index"; index: number };

export function resolveActionItemActivation(item: ActionMenuItem): ActionItemActivation {
  if (item.disabled) return { kind: "none" };
  if (item.kind === "workspace-switch") {
    return typeof item.workspaceIndex === "number"
      ? { kind: "switch-workspace-index", index: item.workspaceIndex }
      : { kind: "none" };
  }
  if (item.kind === "action") {
    return isActionEffectId(item.id)
      ? { kind: "fire-action", actionId: item.id }
      : { kind: "none" };
  }
  if (item.view) return { kind: "open-view", view: item.view as ViewId };
  return { kind: "none" };
}
