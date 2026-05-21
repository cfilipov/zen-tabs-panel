import type { TabIndexRow } from "../runtime/tab-index-client";
import { DUPLICATE_PROMPT_ACTIONS, type DuplicatePromptAction } from "./duplicate-prompt-options";

export type DuplicatePromptActivationContext = {
  selectedIndex: number;
  duplicatePromptTabs: readonly TabIndexRow[];
};

export type DuplicatePromptActivation =
  | { kind: "none" }
  | { kind: "activate-tab"; row: TabIndexRow; rowIndex: number }
  | { kind: "duplicate-prompt-action"; action: DuplicatePromptAction };

export function resolveDuplicatePromptActivation(
  context: DuplicatePromptActivationContext,
  index: number,
  source: "selection" | "shortcut",
): DuplicatePromptActivation {
  if (source === "shortcut") {
    if (index === 0) return { kind: "duplicate-prompt-action", action: "duplicate-switch" };
    const row = context.duplicatePromptTabs[index];
    return row ? { kind: "activate-tab", row, rowIndex: index } : { kind: "none" };
  }

  if (index >= DUPLICATE_PROMPT_ACTIONS.length) {
    const rowIndex = index - DUPLICATE_PROMPT_ACTIONS.length;
    const row = context.duplicatePromptTabs[rowIndex];
    return row ? { kind: "activate-tab", row, rowIndex } : { kind: "none" };
  }

  const action = DUPLICATE_PROMPT_ACTIONS[index];
  return action ? { kind: "duplicate-prompt-action", action } : { kind: "none" };
}

export function resolveDuplicatePromptSelectionActivation(context: DuplicatePromptActivationContext) {
  return resolveDuplicatePromptActivation(context, context.selectedIndex, "selection");
}
