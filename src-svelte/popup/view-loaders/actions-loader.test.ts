import { describe, expect, it } from "vitest";
import { emptyActionsMenuData, loadActionsMenuData } from "./actions-loader";

const emptySnapshot = {
  version: 1,
  currentTabHasParent: false,
  currentTabIsPinned: false,
  childTabCount: 0,
  siblingTabCount: 0,
  parentTabCount: 0,
  unvisitedTabCount: 0,
  domainCount: 0,
  duplicateGroupCount: 0,
  workspaceTabCounts: {},
  previews: {},
};

describe("actions loader", () => {
  it("builds action counts, previews, disabled ids, and workspace navigation icons", async () => {
    const data = await loadActionsMenuData({
      workspaceClient: {
        getWorkspacesWithIcons: async () => [
          { uuid: "a", name: "A", svgContent: "<svg>A</svg>", isActive: false },
          { uuid: "b", name: "B", svgContent: "<svg>B</svg>", isActive: true },
          { uuid: "c", name: "C", svgContent: "<svg>C</svg>", isActive: false },
        ],
      },
      tabIndexClient: {
        getActionsSnapshot: async () => ({
          ...emptySnapshot,
          currentTabIsPinned: true,
          childTabCount: 2,
          domainCount: 7,
          workspaceTabCounts: { a: 1, b: 2, c: 3 },
          previews: {
            "go-to-previous-tab": { title: "Previous" },
            "go-to-prev-vertical-tab": { title: "Above" },
            "go-to-next-vertical-tab": { title: "Below" },
          },
        }),
      },
      extensionClient: {
        listExtensions: async () => [{ id: "ext", name: "Ext", popupUrl: "moz-extension://ext/popup.html", iconDataUrl: "" }],
      },
      historyClient: {
        getRecentlyClosed: async () => [{ title: "Closed" }],
        getNavigationHistory: async () => ({
          index: 1,
          entries: [
            { title: "Back", url: "https://back.test" },
            { title: "Current", url: "https://current.test" },
            { title: "Forward", url: "https://forward.test" },
          ],
        }),
      },
      getSelectedTabDomIds: async () => ["t1", "t2"],
    });

    expect(data.counts).toMatchObject({
      "child-tabs": 2,
      "domains": 7,
      "recently-closed": 1,
      "move-to-workspace": 2,
    });
    expect(data.previewsById["go-back-in-tab"]?.title).toBe("Back");
    expect(data.previewsById["go-forward-in-tab"]?.title).toBe("Forward");
    expect(data.iconHtmlById["go-to-prev-workspace"]).toContain("<svg>A</svg>");
    expect(data.iconHtmlById["go-to-next-workspace"]).toContain("<svg>C</svg>");
    expect(data.disabledIds.has("child-tabs")).toBe(false);
    expect(data.disabledIds.has("go-to-parent-tab")).toBe(true);
    expect(data.disabledIds.has("reset-pinned-tab")).toBe(false);
    expect(data.extensions).toHaveLength(1);
  });

  it("falls back to empty data when dependencies fail individually", async () => {
    const data = await loadActionsMenuData({
      workspaceClient: { getWorkspacesWithIcons: async () => { throw new Error("workspaces"); } },
      tabIndexClient: { getActionsSnapshot: async () => { throw new Error("snapshot"); } },
      extensionClient: { listExtensions: async () => { throw new Error("extensions"); } },
      historyClient: {
        getRecentlyClosed: async () => { throw new Error("closed"); },
        getNavigationHistory: async () => { throw new Error("history"); },
      },
      getSelectedTabDomIds: async () => { throw new Error("selection"); },
    });

    expect(data.workspaces).toEqual([]);
    expect(data.extensions).toEqual([]);
    expect(data.counts["move-to-workspace"]).toBe(0);
    expect(data.disabledIds.has("navigation")).toBe(true);
  });

  it("does not use blank new-tab history entries for actions-menu previews", async () => {
    const data = await loadActionsMenuData({
      workspaceClient: { getWorkspacesWithIcons: async () => [] },
      tabIndexClient: { getActionsSnapshot: async () => emptySnapshot },
      extensionClient: { listExtensions: async () => [] },
      historyClient: {
        getRecentlyClosed: async () => [],
        getNavigationHistory: async () => ({
          index: 1,
          entries: [
            { title: "Real back", url: "https://back.test" },
            { title: "Current", url: "https://current.test" },
            { title: "New Tab", url: "about:newtab" },
          ],
        }),
      },
      getSelectedTabDomIds: async () => [],
    });

    expect(data.previewsById["go-back-in-tab"]?.title).toBe("Real back");
    expect(data.previewsById["go-forward-in-tab"]).toBeNull();
  });

  it("creates a fresh empty action-data object", () => {
    const first = emptyActionsMenuData();
    const second = emptyActionsMenuData();

    first.disabledIds.add("x");
    expect(second.disabledIds.has("x")).toBe(false);
  });
});
