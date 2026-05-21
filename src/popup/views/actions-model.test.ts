import { describe, expect, it } from "vitest";
import {
  actionItemsForPage,
  applyActionSelection,
  prefixItemsForView,
  type ActionSection,
} from "./actions-model";

describe("actions menu model", () => {
  it("derives page items from chrome-provided action sections", () => {
    const model: ActionSection[] = [{
      id: "navigate",
      label: "Navigate",
      page: 1,
      items: [{ id: "go-to-previous-tab", kind: "action", label: "Previous", hotkey: "P", badge: "P", isView: false, page: 1 }],
    }, {
      id: "this-page",
      label: "This page",
      page: 2,
      items: [{ id: "reload-tab", kind: "action", label: "Reload", hotkey: "Shift+R", badge: "⇧R", isView: false, page: 2 }],
    }];
    const pageTwoItems = actionItemsForPage(model, 2);

    expect(pageTwoItems.some((item) => item.id === "reload-tab")).toBe(true);
    expect(pageTwoItems.find((item) => item.id === "reload-tab")?.hotkey).toBe("Shift+R");
  });

  it("derives prefix submenu rows from the navigation tree", () => {
    const items = prefixItemsForView("reorder-tabs");

    expect(items.map((item) => item.id)).toContain("sort-tabs-domain-alpha");
    expect(items.find((item) => item.id === "sort-tabs-domain-alpha")?.hotkey).toBe("D");
  });

  it("marks selected chrome-provided action items", () => {
    const model: ActionSection[] = [{
      id: "navigate",
      label: "Navigate",
      page: 1,
      items: [
        { id: "go-to-previous-tab", kind: "action", label: "Previous", hotkey: "P", badge: "P", isView: false, page: 1 },
        { id: "go-to-parent-tab", kind: "action", label: "Parent", hotkey: "T", badge: "T", isView: false, page: 1 },
      ],
    }];
    const selected = applyActionSelection(model, "go-to-parent-tab");

    expect(selected[0].items[0].selected).toBe(false);
    expect(selected[0].items[1].selected).toBe(true);
  });
});
