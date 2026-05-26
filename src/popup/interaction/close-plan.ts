import type { ViewId } from "../../shared/types";

export type CloseSelectionContext = {
  view: ViewId;
  hasSelectedDuplicateTab: boolean;
  hasSelectedDuplicatePromptTab: boolean;
  hasSelectedDomainRow: boolean;
  hasSelectedTabRow: boolean;
};

export type CloseSelectionPlan =
  | { kind: "duplicate-tab" }
  | { kind: "duplicate-prompt-tab" }
  | { kind: "domain-row" }
  | { kind: "native-tab-row" }
  | { kind: "none" };

export function closeSelectionPlan(context: CloseSelectionContext): CloseSelectionPlan {
  if (context.view === "duplicates" && context.hasSelectedDuplicateTab) {
    return { kind: "duplicate-tab" };
  }
  if (context.view === "duplicate-prompt" && context.hasSelectedDuplicatePromptTab) {
    return { kind: "duplicate-prompt-tab" };
  }
  if (context.view === "domains" && context.hasSelectedDomainRow) {
    return { kind: "domain-row" };
  }
  if (context.hasSelectedTabRow) {
    return { kind: "native-tab-row" };
  }
  return { kind: "none" };
}
