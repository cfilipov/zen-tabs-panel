import { describe, expect, it } from "vitest";
import { emptyActionsMenuData, loadActionsMenuData } from "./actions-loader";

describe("actions loader", () => {
  it("loads the chrome-owned actions model", async () => {
    const data = await loadActionsMenuData({
      tabIndexClient: {
        getActionsViewModel: async () => ({
          version: 9,
          view: "actions",
          sections: [{
            id: "navigate",
            label: "Navigate",
            page: 1,
            items: [{
              id: "go-to-previous-tab",
              kind: "action",
              label: "Previous",
              hotkey: "P",
              badge: "P",
              isView: false,
              page: 1,
            }],
          }],
          workspaces: [],
          workspaceTabCounts: {},
          extensions: [],
          iconHtmlById: {},
          previewsById: {},
          counts: { "child-tabs": 1 },
          disabledIds: ["go-to-parent-tab"],
          selectedIndex: -1,
        }),
      },
    });

    expect(data.sections?.[0]?.items[0]?.id).toBe("go-to-previous-tab");
    expect(data.counts["child-tabs"]).toBe(1);
    expect(data.disabledIds.has("go-to-parent-tab")).toBe(true);
  });

  it("creates a fresh empty action-data object", () => {
    const first = emptyActionsMenuData();
    const second = emptyActionsMenuData();

    first.disabledIds.add("x");
    expect(second.disabledIds.has("x")).toBe(false);
  });
});
