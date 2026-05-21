import { describe, expect, it } from "vitest";
import type { TabIndexRow } from "../runtime/tab-index-client";
import { loadTabInfoView } from "./tab-info-loader";

function row(domId: string): TabIndexRow {
  return {
    index: 0,
    id: null,
    domId,
    title: domId,
    url: "https://example.test",
    domain: "example.test",
    workspaceId: "ws-1",
    pinned: false,
    essential: false,
    active: domId === "tab-1",
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

describe("tab info loader", () => {
  it("prefers the completed tab info view model when available", async () => {
    const result = await loadTabInfoView(
      { getActiveRow: async () => { throw new Error("fallback should not run"); }, getRowsByDomIds: async () => [] },
      {
        getTabInfo: async () => { throw new Error("fallback should not run"); },
        getHistoryVisits: async () => [],
        getTabInfoViewModel: async () => ({
          info: {
            domId: "tab-1",
            title: "Example",
            url: "https://example.test",
            favIconUrl: "",
            pinned: false,
            workspaceId: "ws-1",
            lastAccessed: 0,
            status: "loaded",
            sessionEntries: [],
            memory: null,
            cpuTime: null,
            duplicateDomIds: [],
            panelTabUuid: null,
            panelParentUuid: null,
            panelStats: null,
            parentTitle: null,
            parentDomId: null,
            parentFavIconUrl: null,
          },
          visits: [],
          duplicates: [],
          workspaces: [{ uuid: "ws-1", name: "One", svgContent: "", isActive: true }],
          selectedIndex: -1,
        }),
      },
      { getWorkspacesWithIcons: async () => { throw new Error("fallback should not run"); } },
    );

    expect(result.info?.domId).toBe("tab-1");
    expect(result.workspaces[0]?.uuid).toBe("ws-1");
  });

  it("loads active tab info, visits, workspaces, and duplicate rows from focused clients", async () => {
    const duplicateCalls: string[][] = [];
    const visitCalls: string[] = [];
    const result = await loadTabInfoView(
      {
        getActiveRow: async () => row("tab-1"),
        getRowsByDomIds: async (domIds) => {
          duplicateCalls.push(domIds);
          return domIds.map(row);
        },
      },
      {
        getTabInfo: async () => ({
          domId: "tab-1",
          title: "Example",
          url: "https://example.test",
          favIconUrl: "",
          pinned: false,
          workspaceId: "ws-1",
          lastAccessed: 0,
          status: "loaded",
          sessionEntries: [{ url: "https://example.test/past", title: "Past" }, { url: "about:blank", title: "" }],
          memory: null,
          cpuTime: null,
          duplicateDomIds: ["tab-1", "tab-2"],
          panelTabUuid: null,
          panelParentUuid: null,
          panelStats: null,
          parentTitle: null,
          parentDomId: null,
          parentFavIconUrl: null,
        }),
        getHistoryVisits: async (url) => {
          visitCalls.push(url);
          return [{ visitTime: 10, transition: "link" }];
        },
      },
      {
        getWorkspacesWithIcons: async () => [{ uuid: "ws-1", name: "One", svgContent: "", isActive: true }],
      },
    );

    expect(duplicateCalls).toEqual([["tab-1", "tab-2"]]);
    expect(visitCalls).toEqual(["https://example.test", "https://example.test/past"]);
    expect(result.info?.domId).toBe("tab-1");
    expect(result.visits.map((visit) => visit.title)).toEqual(["Example", "Past"]);
    expect(result.duplicates.map((duplicate) => duplicate.domId)).toEqual(["tab-1", "tab-2"]);
    expect(result.workspaces).toHaveLength(1);
    expect(result.selectedIndex).toBe(-1);
  });

  it("returns an empty view when no active row is indexed", async () => {
    const result = await loadTabInfoView(
      { getActiveRow: async () => null, getRowsByDomIds: async () => [] },
      { getTabInfo: async () => { throw new Error("should not load"); }, getHistoryVisits: async () => [] },
      { getWorkspacesWithIcons: async () => [] },
    );

    expect(result.info).toBeNull();
    expect(result.duplicates).toEqual([]);
  });
});
