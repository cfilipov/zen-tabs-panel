import type { ViewId } from "../../shared/types";
import { nextActionSectionIndex, type ActionSectionShape } from "./actions-navigation";
import { nextDuplicatePromptSectionIndex, type SelectionContext } from "./selection";

export type SectionJumpContext = {
  view: ViewId;
  selection: SelectionContext;
  actionSections: readonly ActionSectionShape[];
  currentPage: number;
  visibleItemCount: number;
};

export function nextSectionJumpIndex(context: SectionJumpContext, delta: 1 | -1) {
  if (context.view === "duplicate-prompt") {
    return nextDuplicatePromptSectionIndex(context.selection, delta);
  }
  if (context.view !== "actions") return null;
  return nextActionSectionIndex({
    sections: context.actionSections,
    currentPage: context.currentPage,
    visibleItemCount: context.visibleItemCount,
    selectedIndex: context.selection.selectedIndex,
    delta,
  });
}
