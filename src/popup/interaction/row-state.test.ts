import { describe, expect, it } from "vitest";
import type { RecentlyClosedRow } from "../runtime/history-client";
import type { DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";
import {
  keepOnlyTabInfoDuplicate,
  removeRecentlyClosedRow,
  removeTabFromDuplicateGroups,
  removeTabFromRows,
  removeTabInfoDuplicate,
  type NativeRow,
} from "./row-state";

function tab(domId: string): TabIndexRow {
  return {
    index: 0,
    id: null,
    domId,
    title: domId,
    url: `https://${domId}.test/`,
    domain: `${domId}.test`,
    workspaceId: null,
    pinned: false,
    essential: false,
    active: false,
    lastAccessed: 0,
    favIconUrl: "",
    unread: false,
    openerTabDomId: null,
    splitView: false,
    splitGroupId: null,
    pending: false,
    panelTabUuid: null,
    panelParentUuid: null,
  };
}

function recentlyClosed(sessionId: string): RecentlyClosedRow {
  return {
    sessionId,
    title: sessionId,
    url: `https://${sessionId}.test/`,
    favIconUrl: "",
    pinned: false,
    lastModified: 0,
  };
}

describe("row state transitions", () => {
  it("removes a tab row and clamps selected index", () => {
    const rows: NativeRow[] = [tab("a"), tab("b")];
    expect(removeTabFromRows({ rows, total: 2, selectedIndex: 1, domId: "b" })).toEqual({
      rows: [rows[0]],
      total: 1,
      selectedIndex: 0,
    });
    expect(removeTabFromRows({ rows, total: 2, selectedIndex: 0, domId: "missing" })).toEqual({
      rows,
      total: 2,
      selectedIndex: 0,
    });
  });

  it("removes tabs from duplicate groups and drops singleton groups", () => {
    const groups: DuplicateGroupRow[] = [
      { kind: "duplicate-group", url: "u1", title: "u1", domain: "a.test", favIconUrl: "", tabs: [tab("a"), tab("b")] },
      { kind: "duplicate-group", url: "u2", title: "u2", domain: "c.test", favIconUrl: "", tabs: [tab("c"), tab("d"), tab("e")] },
    ];

    expect(removeTabFromDuplicateGroups(groups, "a")).toEqual([
      { ...groups[1], tabs: groups[1].tabs },
    ]);
    expect(removeTabFromDuplicateGroups(groups, "d")).toEqual([
      groups[0],
      { ...groups[1], tabs: [groups[1].tabs[0], groups[1].tabs[2]] },
    ]);
  });

  it("filters tab-info duplicate rows", () => {
    const rows = [tab("self"), tab("other")];
    expect(removeTabInfoDuplicate(rows, "other")).toEqual([rows[0]]);
    expect(keepOnlyTabInfoDuplicate(rows, "self")).toEqual([rows[0]]);
  });

  it("removes recently closed rows and clamps selection", () => {
    const rows = [recentlyClosed("a"), recentlyClosed("b")];
    expect(removeRecentlyClosedRow({ rows, selectedIndex: 1, sessionId: "b" })).toEqual({
      rows: [rows[0]],
      selectedIndex: 0,
    });
    expect(removeRecentlyClosedRow({ rows, selectedIndex: 0, sessionId: "missing" })).toEqual({
      rows,
      selectedIndex: 0,
    });
  });
});
