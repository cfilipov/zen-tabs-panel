import type { RecentlyClosedRow } from "../runtime/history-client";
import type { DomainIndexRow, DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";

export type NativeRow = TabIndexRow | DomainIndexRow;

function isTabRow(row: NativeRow): row is TabIndexRow {
  return row.kind !== "domain";
}

function selectionAfterRemoval(selectedIndex: number, count: number) {
  if (count <= 0) return -1;
  return selectedIndex >= count ? count - 1 : selectedIndex;
}

export function removeTabFromRows(options: {
  rows: readonly NativeRow[];
  total: number;
  selectedIndex: number;
  domId: string;
}) {
  const rows = options.rows.filter((row) => !isTabRow(row) || row.domId !== options.domId);
  const removed = rows.length !== options.rows.length;
  const total = removed ? Math.max(0, options.total - 1) : options.total;
  return {
    rows,
    total,
    selectedIndex: removed ? selectionAfterRemoval(options.selectedIndex, total) : options.selectedIndex,
  };
}

export function removeTabFromDuplicateGroups(groups: readonly DuplicateGroupRow[], domId: string) {
  return groups
    .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => tab.domId !== domId) }))
    .filter((group) => group.tabs.length > 1);
}

export function removeTabInfoDuplicate(rows: readonly TabIndexRow[], domId: string) {
  return rows.filter((tab) => tab.domId !== domId);
}

export function keepOnlyTabInfoDuplicate(rows: readonly TabIndexRow[], domId: string) {
  return rows.filter((tab) => tab.domId === domId);
}

export function removeRecentlyClosedRow(options: {
  rows: readonly RecentlyClosedRow[];
  selectedIndex: number;
  sessionId: string;
}) {
  const rows = options.rows.filter((row) => row.sessionId !== options.sessionId);
  const removed = rows.length !== options.rows.length;
  return {
    rows,
    selectedIndex: removed ? selectionAfterRemoval(options.selectedIndex, rows.length) : options.selectedIndex,
  };
}
