import { describe, expect, it } from "vitest";
import { NAVIGATION_TREE } from "../../shared/navigation-tree";
import {
  actionItemsForPage,
  appendWorkspaceSwitchItems,
  buildActionsMenuModel,
  prefixItemsForView,
} from "./actions-model";

describe("actions menu model", () => {
  it("renders only ids from the navigation tree", () => {
    const ids = new Set<string>(NAVIGATION_TREE.flatMap((node) => node.kind === "prefix" ? [node.id, ...node.children.map((child) => child.id)] : [node.id]));
    const model = buildActionsMenuModel();
    for (const item of model.flatMap((section) => section.items)) {
      expect(ids.has(item.id), item.id).toBe(true);
    }
  });

  it("keeps badges derived from chords", () => {
    const model = buildActionsMenuModel();
    const parentTabs = model.flatMap((section) => section.items).find((item) => item.id === "parent-tabs");
    expect(parentTabs?.hotkey).toBe("Shift+T");
    expect(parentTabs?.badge).toBe("⇧T");
  });

  it("applies availability from a disabled id set without changing tree metadata", () => {
    const item = buildActionsMenuModel(new Set(["go-to-parent-tab"]))
      .flatMap((section) => section.items)
      .find((candidate) => candidate.id === "go-to-parent-tab");

    expect(item).toMatchObject({
      id: "go-to-parent-tab",
      label: "Parent",
      disabled: true,
    });
  });

  it("derives page items from the shared action model", () => {
    const model = buildActionsMenuModel();
    const pageTwoItems = actionItemsForPage(model, 2);

    expect(pageTwoItems.some((item) => item.id === "reload-tab")).toBe(true);
    expect(pageTwoItems.find((item) => item.id === "reload-tab")?.hotkey).toBe("Shift+R");
    expect(model.flatMap((section) => section.items).find((item) => item.id === "move-to-folder")?.hotkey).toBe("Shift+M");
    expect(pageTwoItems.find((item) => item.id === "toggle-reader-mode")?.hotkey).toBe("Shift+O");
  });

  it("derives prefix submenu rows from the navigation tree", () => {
    const items = prefixItemsForView("reorder-tabs");

    expect(items.map((item) => item.id)).toContain("sort-tabs-domain-alpha");
    expect(items.find((item) => item.id === "sort-tabs-domain-alpha")?.hotkey).toBe("D");
  });

  it("appends real workspace switch rows without inventing icons", () => {
    const model = appendWorkspaceSwitchItems(
      buildActionsMenuModel(),
      [
        { uuid: "ws-1", name: "Main", isActive: false, svgContent: "" },
        { uuid: "ws-2", name: "Dev", isActive: true, svgContent: "<svg></svg>" },
      ],
      { "ws-1": 12, "ws-2": 3 },
    );
    const workspaces = model.find((section) => section.id === "workspaces" && section.page === 1);

    expect(workspaces?.items.slice(-2)).toMatchObject([
      {
        id: "workspace-switch:ws-1",
        kind: "workspace-switch",
        workspaceId: "ws-1",
        workspaceIndex: 0,
        workspaceIconHtml: "",
        badge: "1",
        count: 12,
        disabled: false,
      },
      {
        id: "workspace-switch:ws-2",
        kind: "workspace-switch",
        workspaceId: "ws-2",
        workspaceIndex: 1,
        workspaceIconHtml: "<svg></svg>",
        badge: "2",
        count: 3,
        disabled: true,
      },
    ]);
  });
});
