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
};

export type ViewActivation =
  | { kind: "none" }
  | { kind: "activate-tab"; row: TabIndexRow }
  | { kind: "activate-domain"; row: DomainIndexRow }
  | { kind: "navigate-history-index"; index: number }
  | { kind: "restore-closed-tab"; row: RecentlyClosedRow }
  | { kind: "move-to-workspace"; row: WorkspaceRow }
  | { kind: "reopen-in-container"; row: ContainerRow }
  | { kind: "move-to-folder"; row: FolderRow }
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
    return index >= 0 && index < history.entries.length && index !== history.index ? index : null;
  }
  const target = history.entries
    .map((entry, navIndex) => ({ entry, navIndex }))
    .filter((candidate) => candidate.navIndex !== history.index)[index];
  return target ? target.navIndex : null;
}

export function resolveViewActivation(
  context: ViewActivationContext,
  index: number,
  source: "selection" | "shortcut",
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
    return row ? { kind: "move-to-workspace", row } : { kind: "none" };
  }

  if (context.view === "open-in-container") {
    const row = context.containerRows[index];
    return row ? { kind: "reopen-in-container", row } : { kind: "none" };
  }

  if (context.view === "move-to-folder") {
    const row = context.folderRows[index];
    return row ? { kind: "move-to-folder", row } : { kind: "none" };
  }

  if (context.view === "profiles") {
    const row = context.profileRows[index];
    return row ? { kind: "launch-profile", row } : { kind: "none" };
  }

  if (context.view === "duplicate-prompt") {
    const action = DUPLICATE_PROMPT_ACTIONS[index];
    return action ? { kind: "duplicate-prompt-action", action } : { kind: "none" };
  }

  const row = rowForIndex(context.rows, context.offset, index);
  if (isTabRow(row)) return { kind: "activate-tab", row };
  if (isDomainRow(row)) return { kind: "activate-domain", row };
  return { kind: "none" };
}

export function resolveSelectionActivation(context: ViewActivationContext) {
  return resolveViewActivation(context, context.selectedIndex, "selection");
}
