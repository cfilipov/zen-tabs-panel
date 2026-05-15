import type { ViewId } from "../../shared/types";
import type { ProfileRow } from "../runtime/profile-client";

export type SelectionContext = {
  view: ViewId;
  selectedIndex: number;
  actionCount: number;
  prefixCount: number;
  navigationCount: number;
  recentlyClosedCount: number;
  workspaceCount: number;
  containerCount: number;
  folderCount: number;
  profileRows: readonly ProfileRow[];
  duplicatePromptCount: number;
  rowCount: number;
  isPrefixView: boolean;
};

export function selectionLength(context: SelectionContext) {
  if (context.view === "actions") return context.actionCount;
  if (context.isPrefixView) return context.prefixCount;
  if (context.view === "navigation") return context.navigationCount;
  if (context.view === "recently-closed") return context.recentlyClosedCount;
  if (context.view === "move-to-workspace") return context.workspaceCount;
  if (context.view === "open-in-container") return context.containerCount;
  if (context.view === "move-to-folder") return context.folderCount;
  if (context.view === "profiles") return context.profileRows.length;
  if (context.view === "duplicates" || context.view === "tab-info") return 0;
  if (context.view === "duplicate-prompt") return context.duplicatePromptCount;
  return context.rowCount;
}

export function isSelectableIndex(context: SelectionContext, index: number) {
  if (context.view === "profiles") {
    return !!context.profileRows[index] && !context.profileRows[index].isCurrent;
  }
  if (context.view === "duplicates" || context.view === "tab-info") return false;
  if (context.view === "duplicate-prompt") return index >= 0 && index < context.duplicatePromptCount;
  return index >= 0;
}

export function nextSelectionIndex(context: SelectionContext, delta: 1 | -1) {
  const length = selectionLength(context);
  if (!length) return -1;

  let next = context.selectedIndex < 0 ? (delta > 0 ? -1 : 0) : context.selectedIndex;
  for (let attempts = 0; attempts < length; attempts += 1) {
    next = (next + delta + length) % length;
    if (isSelectableIndex(context, next)) return next;
  }
  return context.selectedIndex;
}
