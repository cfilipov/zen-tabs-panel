import type { ViewId } from "../../shared/types";
import {
  isChromeModelIntentView,
  isNativePrefixView,
} from "../view-loaders/view-registry";

type ActivationSource = "selection" | "shortcut";

export type ActivationPlan =
  | { kind: "action-selection"; index: number }
  | { kind: "prefix-selection"; index: number }
  | { kind: "chrome-model-row"; index: number; source: ActivationSource; switchToTarget: boolean }
  | { kind: "duplicate-prompt"; index: number; source: ActivationSource }
  | { kind: "domain-close-confirm"; index: number }
  | { kind: "none" };

function activationPlanForIndex(
  view: ViewId,
  index: number,
  source: ActivationSource,
  switchToTarget = false,
): ActivationPlan {
  if (isChromeModelIntentView(view)) {
    return { kind: "chrome-model-row", index, source, switchToTarget };
  }
  if (view === "duplicate-prompt") {
    return { kind: "duplicate-prompt", index, source };
  }
  if (view === "domain-close-confirm") {
    return { kind: "domain-close-confirm", index };
  }
  return { kind: "none" };
}

export function activationPlanForSelection(
  view: ViewId,
  selectedIndex: number,
  switchToTarget = false,
): ActivationPlan {
  if (view === "actions") return { kind: "action-selection", index: selectedIndex };
  if (view === "command-palette") return { kind: "action-selection", index: selectedIndex };
  if (isNativePrefixView(view)) return { kind: "prefix-selection", index: selectedIndex };
  return activationPlanForIndex(view, selectedIndex, "selection", switchToTarget);
}

export function activationPlanForShortcut(
  view: ViewId,
  index: number,
  switchToTarget = false,
): ActivationPlan {
  return activationPlanForIndex(view, index, "shortcut", switchToTarget);
}

export function activationPlanForRenderedRow(
  view: ViewId,
  index: number,
  switchToTarget = false,
): ActivationPlan {
  return activationPlanForIndex(view, index, "selection", switchToTarget);
}

export function shouldWaitForVisibleShortcutModel(
  view: ViewId,
  chordKey: string | null,
  visibleShortcutCount: number,
) {
  if (!chordKey || visibleShortcutCount > 0) return false;
  return view === "actions" || isNativePrefixView(view);
}
