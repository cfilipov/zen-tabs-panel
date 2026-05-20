import type { ContainerRow } from "../runtime/container-client";
import type { FolderRow } from "../runtime/folder-client";
import type { NavigationHistory, RecentlyClosedRow } from "../runtime/history-client";
import type { ProfileRow } from "../runtime/profile-client";
import type { DomainIndexRow, TabIndexRow } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";
import type { ViewId } from "../../shared/types";
import { DUPLICATE_PROMPT_ACTIONS, type DuplicatePromptAction } from "./duplicate-prompt-options";

export type NativeRow = TabIndexRow | DomainIndexRow;

export type ViewActivationContext = {
  view: ViewId;
  selectedIndex: number;
  offset: number;
  rows: readonly NativeRow[];
  navigationHistory: NavigationHistory | null;
  recentlyClosedRows: readonly RecentlyClosedRow[];
  workspaceRows: readonly WorkspaceRow[];
  containerRows: readonly ContainerRow[];
  folderRows: readonly FolderRow[];
  profileRows: readonly ProfileRow[];
  duplicateTabs: readonly TabIndexRow[];
  duplicatePromptTabs: readonly TabIndexRow[];
};

export type ViewActivation =
  | { kind: "none" }
  | { kind: "activate-tab"; row: TabIndexRow }
  | { kind: "activate-domain"; row: DomainIndexRow }
  | { kind: "navigate-history-index"; index: number }
  | { kind: "restore-closed-tab"; row: RecentlyClosedRow }
  | { kind: "move-to-workspace"; row: WorkspaceRow; switchToTarget?: boolean }
  | { kind: "reopen-in-container"; row: ContainerRow }
  | { kind: "move-to-folder"; row: FolderRow; switchToTarget?: boolean }
  | { kind: "launch-profile"; row: ProfileRow }
  | { kind: "duplicate-prompt-action"; action: DuplicatePromptAction };

function isDomainRow(row: NativeRow | null): row is DomainIndexRow {
  return row?.kind === "domain";
}

function isTabRow(row: NativeRow | null): row is TabIndexRow {
  return !!row && row.kind !== "domain";
}

function rowForIndex(rows: readonly NativeRow[], offset: number, index: number) {
  const relativeIndex = index - offset;
  return relativeIndex >= 0 ? rows[relativeIndex] ?? null : null;
}

function navigationIndexFor(history: NavigationHistory | null, index: number, source: "selection" | "shortcut") {
  if (!history) return null;
  if (source === "selection") {
    if (index < 0 || index >= history.entries.length || index === history.index) return null;
    return history.entries[index].historyIndex ?? index;
  }
  const target = history.entries
    .map((entry, navIndex) => ({ entry, navIndex }))
    .filter((candidate) => candidate.navIndex !== history.index)[index];
  return target ? target.entry.historyIndex ?? target.navIndex : null;
}

export function resolveViewActivation(
  context: ViewActivationContext,
  index: number,
  source: "selection" | "shortcut",
  options: { switchToTarget?: boolean } = {},
): ViewActivation {
  if (context.view === "navigation") {
    const navIndex = navigationIndexFor(context.navigationHistory, index, source);
    return navIndex == null ? { kind: "none" } : { kind: "navigate-history-index", index: navIndex };
  }

  if (context.view === "recently-closed") {
    const row = context.recentlyClosedRows[index];
    return row ? { kind: "restore-closed-tab", row } : { kind: "none" };
  }

  if (context.view === "move-to-workspace") {
    const row = context.workspaceRows[index];
    if (row?.isActive) return { kind: "none" };
    return row ? { kind: "move-to-workspace", row, switchToTarget: options.switchToTarget } : { kind: "none" };
  }

  if (context.view === "open-in-container") {
    const row = context.containerRows[index];
    return row ? { kind: "reopen-in-container", row } : { kind: "none" };
  }

  if (context.view === "move-to-folder") {
    const row = context.folderRows[index];
    return row ? { kind: "move-to-folder", row, switchToTarget: options.switchToTarget } : { kind: "none" };
  }

  if (context.view === "profiles") {
    const row = context.profileRows[index];
    return row ? { kind: "launch-profile", row } : { kind: "none" };
  }

  if (context.view === "duplicates") {
    const row = context.duplicateTabs[index];
    return row ? { kind: "activate-tab", row } : { kind: "none" };
  }

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

  const row = source === "shortcut" ? context.rows[index] ?? null : rowForIndex(context.rows, context.offset, index);
  if (isTabRow(row)) return { kind: "activate-tab", row };
  if (isDomainRow(row)) return { kind: "activate-domain", row };
  return { kind: "none" };
}

export function resolveSelectionActivation(context: ViewActivationContext, options: { switchToTarget?: boolean } = {}) {
  return resolveViewActivation(context, context.selectedIndex, "selection", options);
}
