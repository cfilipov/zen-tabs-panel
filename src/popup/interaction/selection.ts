import type { ViewId } from "../../shared/types";
import type { ProfileRow } from "../runtime/profile-client";

export type SelectionContext = {
  view: ViewId;
  selectedIndex: number;
  actionCount: number;
  commandCount: number;
  prefixCount: number;
  navigationCount: number;
  recentlyClosedCount: number;
  workspaceCount: number;
  containerCount: number;
  folderCount: number;
  profileRows: readonly ProfileRow[];
  duplicateTabCount: number;
  duplicatePromptCount: number;
  duplicatePromptActionCount: number;
  domainCloseConfirmCount: number;
  rowCount: number;
  isPrefixView: boolean;
};

export function selectionLength(context: SelectionContext) {
  if (context.view === "actions") return context.actionCount;
  if (context.view === "command-palette") return context.commandCount;
  if (context.isPrefixView) return context.prefixCount;
  if (context.view === "navigation") return context.navigationCount;
  if (context.view === "recently-closed") return context.recentlyClosedCount;
  if (context.view === "move-to-workspace") return context.workspaceCount;
  if (context.view === "open-in-container" || context.view === "workspace-profiles") return context.containerCount;
  if (context.view === "move-to-folder") return context.folderCount;
  if (context.view === "profiles") return context.profileRows.length;
  if (context.view === "duplicates") return context.duplicateTabCount;
  if (context.view === "tab-info") return 0;
  if (context.view === "duplicate-prompt") return context.duplicatePromptCount;
  if (context.view === "domain-close-confirm") return context.domainCloseConfirmCount;
  return context.rowCount;
}

export function isSelectableIndex(context: SelectionContext, index: number) {
  if (context.view === "profiles") {
    return !!context.profileRows[index] && !context.profileRows[index].isCurrent;
  }
  if (context.view === "duplicates") return index >= 0 && index < context.duplicateTabCount;
  if (context.view === "tab-info") return false;
  if (context.view === "duplicate-prompt") return index >= 0 && index < context.duplicatePromptCount;
  if (context.view === "domain-close-confirm") return index >= 0 && index < context.domainCloseConfirmCount;
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

export function duplicatePromptPreviewDomId(
  view: ViewId,
  selectedIndex: number,
  existingDomId: string | null,
  duplicateDomIds: readonly string[] = [],
  actionCount = 0,
) {
  if (view !== "duplicate-prompt") return null;
  if (selectedIndex === 0) return existingDomId;
  if (selectedIndex >= actionCount) return duplicateDomIds[selectedIndex - actionCount] ?? null;
  return null;
}

export function nextDuplicatePromptSectionIndex(context: SelectionContext, delta: 1 | -1) {
  if (context.view !== "duplicate-prompt") return null;
  const actionCount = context.duplicatePromptActionCount;
  const rowCount = Math.max(0, context.duplicatePromptCount - actionCount);
  if (!actionCount || !rowCount) return null;
  const inRows = context.selectedIndex >= actionCount;
  if (delta > 0) return inRows ? 0 : actionCount;
  return inRows ? 0 : actionCount;
}
