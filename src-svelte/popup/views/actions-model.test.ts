import { describe, expect, it } from "vitest";
import { NAVIGATION_TREE } from "../../shared/navigation-tree";
import { buildActionsMenuModel } from "./actions-model";

describe("actions menu model", () => {
  it("renders only ids from the navigation tree", () => {
    const ids = new Set(NAVIGATION_TREE.flatMap((node) => node.kind === "prefix" ? [node.id, ...node.children.map((child) => child.id)] : [node.id]));
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
});
