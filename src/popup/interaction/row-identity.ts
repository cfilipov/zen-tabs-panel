import type { ViewId } from "../../shared/types";
import type { ContainerRow } from "../runtime/container-client";
import type { FolderRow } from "../runtime/folder-client";
import type { NavigationHistory, RecentlyClosedRow } from "../runtime/history-client";
import type { ProfileRow } from "../runtime/profile-client";
import type { TabIndexRow } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";
import type { NativeListRow } from "../view-loaders/list-loader";
import { isDomainRow, isTabRow } from "../view-loaders/list-row";
import { isNativeListView, isRecentlyClosedView } from "../view-loaders/view-registry";
import { rowInWindow } from "./list-window";

type ActivationSource = "selection" | "shortcut";

export type StableRowIdentityContext = {
  view: ViewId;
  offset: number;
  navigationHistory: NavigationHistory | null;
  recentlyClosedRows: readonly RecentlyClosedRow[];
  duplicateTabs: readonly TabIndexRow[];
  rows: readonly NativeListRow[];
  workspaceRows: readonly WorkspaceRow[];
  containerRows: readonly ContainerRow[];
  folderRows: readonly FolderRow[];
  profileRows: readonly ProfileRow[];
};

export function navigationEntryForShortcutIndex(history: NavigationHistory | null, index: number) {
  if (!history || !Number.isInteger(index) || index < 0) return null;
  return history.entries
    .map((entry, navIndex) => ({ entry, navIndex }))
    .filter((candidate) => candidate.navIndex !== history.index)[index] ?? null;
}

function rowForNativeListIndex(context: StableRowIdentityContext, index: number, source: ActivationSource) {
  const absoluteIndex = source === "shortcut" ? context.offset + index : index;
  return rowInWindow(context.rows, context.offset, absoluteIndex);
}

export function stableRowIdForActivation(
  context: StableRowIdentityContext,
  index: number,
  source: ActivationSource,
) {
  if (!Number.isInteger(index) || index < 0) return null;

  if (context.view === "navigation") {
    const candidate = source === "shortcut"
      ? navigationEntryForShortcutIndex(context.navigationHistory, index)
      : context.navigationHistory?.entries[index]
        ? { entry: context.navigationHistory.entries[index], navIndex: index }
        : null;
    const target = candidate?.entry.historyIndex ?? candidate?.navIndex;
    return target == null ? null : String(target);
  }

  if (isRecentlyClosedView(context.view)) {
    return context.recentlyClosedRows[index]?.sessionId ?? null;
  }

  if (context.view === "duplicates") {
    return context.duplicateTabs[index]?.domId ?? null;
  }

  if (isNativeListView(context.view)) {
    const row = rowForNativeListIndex(context, index, source);
    if (isDomainRow(row)) return row.domain;
    if (isTabRow(row)) return row.domId;
    return null;
  }

  if (context.view === "move-to-workspace") {
    return context.workspaceRows[index]?.uuid ?? null;
  }

  if (context.view === "open-in-container" || context.view === "workspace-profiles") {
    const userContextId = context.containerRows[index]?.userContextId;
    return userContextId == null ? null : String(userContextId);
  }

  if (context.view === "move-to-folder") {
    return context.folderRows[index]?.id ?? null;
  }

  if (context.view === "profiles") {
    return context.profileRows[index]?.name ?? null;
  }

  return null;
}
