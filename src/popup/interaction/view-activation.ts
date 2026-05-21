import type { TabIndexRow } from "../runtime/tab-index-client";
import type { ViewId } from "../../shared/types";
import { DUPLICATE_PROMPT_ACTIONS, type DuplicatePromptAction } from "./duplicate-prompt-options";

export type ViewActivationContext = {
  view: ViewId;
  selectedIndex: number;
  duplicatePromptTabs: readonly TabIndexRow[];
};

export type ViewActivation =
  | { kind: "none" }
  | { kind: "activate-tab"; row: TabIndexRow }
  | { kind: "duplicate-prompt-action"; action: DuplicatePromptAction };

export function resolveViewActivation(
  context: ViewActivationContext,
  index: number,
  source: "selection" | "shortcut",
): ViewActivation {
  if (context.view === "duplicate-prompt") {
    if (source === "shortcut") {
      if (index === 0) return { kind: "duplicate-prompt-action", action: "duplicate-switch" };
      const row = context.duplicatePromptTabs[index];
      return row ? { kind: "activate-tab", row } : { kind: "none" };
    }
    if (index >= DUPLICATE_PROMPT_ACTIONS.length) {
      const row = context.duplicatePromptTabs[index - DUPLICATE_PROMPT_ACTIONS.length];
      return row ? { kind: "activate-tab", row } : { kind: "none" };
    }
    const action = DUPLICATE_PROMPT_ACTIONS[index];
    return action ? { kind: "duplicate-prompt-action", action } : { kind: "none" };
  }

  return { kind: "none" };
}

export function resolveSelectionActivation(context: ViewActivationContext) {
  return resolveViewActivation(context, context.selectedIndex, "selection");
}
