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
          prefixItemsByView: {
            "reorder-tabs": [{
              id: "sort-tabs-domain-alpha",
              kind: "action",
              label: "Domain",
              hotkey: "D",
              badge: "D",
              isView: false,
              page: 1,
            }],
          },
          workspaces: [],
          extensions: [],
          selectedIndex: -1,
        }),
      },
    });

    expect(data.sections?.[0]?.items[0]?.id).toBe("go-to-previous-tab");
    expect(data.prefixItemsByView?.["reorder-tabs"]?.[0]?.id).toBe("sort-tabs-domain-alpha");
    expect(data.workspaces).toEqual([]);
    expect(data.extensions).toEqual([]);
  });

  it("creates a fresh empty action-data object", () => {
    const data = emptyActionsMenuData();

    expect(data.sections).toEqual([]);
    expect(data.prefixItemsByView).toEqual({});
    expect(data.workspaces).toEqual([]);
    expect(data.extensions).toEqual([]);
  });
});
