import { describe, expect, it } from "vitest";
import { NAVIGATION_TREE } from "../../shared/navigation-tree";
import {
  actionItemsForPage,
  actionNodesForSections,
  appendWorkspaceSwitchItems,
  buildActionsMenuModel,
  prefixChildNodesForView,
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

  it("derives page items and interpreter nodes from the same action model", () => {
    const model = buildActionsMenuModel();
    const pageTwoItems = actionItemsForPage(model, 2);
    const nodes = actionNodesForSections(model);

    expect(pageTwoItems.some((item) => item.id === "reload-tab")).toBe(true);
    expect(nodes.find((node) => node.id === "reload-tab")?.chord).toBe("Shift+R");
    expect(nodes.find((node) => node.id === "move-to-folder")?.chord).toBe("Shift+M");
    expect(nodes.find((node) => node.id === "toggle-reader-mode")?.chord).toBe("Shift+O");
  });

  it("derives prefix submenu rows from the navigation tree", () => {
    const items = prefixItemsForView("reorder-tabs");
    const nodes = prefixChildNodesForView("reorder-tabs");

    expect(items.map((item) => item.id)).toContain("sort-tabs-domain-alpha");
    expect(nodes.find((node) => node.id === "sort-tabs-domain-alpha")?.chord).toBe("D");
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
        workspaceIconHtml: "",
        badge: "1",
        count: 12,
        disabled: false,
      },
      {
        id: "workspace-switch:ws-2",
        kind: "workspace-switch",
        workspaceId: "ws-2",
        workspaceIconHtml: "<svg></svg>",
        badge: "2",
        count: 3,
        disabled: true,
      },
    ]);
  });
});
