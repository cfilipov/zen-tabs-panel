import { describe, expect, it } from "vitest";
import { createPopupState } from "./state.svelte";

describe("popup state", () => {
  it("resets selection and sidebar focus on view changes", () => {
    const store = createPopupState();
    store.state.selectedIndex = 3;
    store.state.sidebarFocused = true;
    store.state.sidebarSelectedIndex = 2;

    store.setView("last-visited");

    expect(store.state.currentView).toBe("last-visited");
    expect(store.state.selectedIndex).toBe(-1);
    expect(store.state.sidebarFocused).toBe(false);
    expect(store.state.sidebarSelectedIndex).toBe(-1);
  });

  it("wraps selection inside the current actions page", () => {
    const store = createPopupState();
    store.setItems([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
    store.state.pageCount = 2;
    store.state.pageBounds = [[0, 2], [2, 4]];
    store.state.currentPage = 2;

    store.moveSelection(1);
    expect(store.state.selectedIndex).toBe(2);
    store.moveSelection(1);
    expect(store.state.selectedIndex).toBe(3);
    store.moveSelection(1);
    expect(store.state.selectedIndex).toBe(2);
  });

  it("clears stale workspace filters when the workspace map changes", () => {
    const store = createPopupState();
    store.setWorkspaceFilter("old");

    store.setWorkspaceMap({ next: { name: "Next" } }, "next");

    expect(store.state.workspaceFilter).toBe("all");
  });
});
