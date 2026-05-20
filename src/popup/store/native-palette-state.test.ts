import { describe, expect, it } from "vitest";
import { createNativePaletteState } from "./native-palette-state.svelte";

describe("native palette state", () => {
  it("initializes the live palette state defaults", () => {
    const store = createNativePaletteState();

    expect(store.state.currentView).toBe("actions");
    expect(store.state.selectedIndex).toBe(-1);
    expect(store.state.workspaceFilter).toBe("all");
    expect(store.state.disabledActionIds).toBeInstanceOf(Set);
  });

  it("clears loaded view data without discarding action metadata or user filters", () => {
    const store = createNativePaletteState();
    store.state.currentView = "last-visited";
    store.state.rows = [{
      kind: "tab",
      index: 0,
      domId: "tab-1",
      title: "One",
      url: "https://example.com",
      domain: "example.com",
      workspaceId: "workspace-1",
      pinned: false,
      essential: false,
      active: false,
      favIconUrl: "",
      pending: false,
    }];
    store.state.total = 1;
    store.state.offset = 4;
    store.state.listVersion = 12;
    store.state.currentDomain = "example.com";
    store.state.selectedIndex = 2;
    store.state.workspaceFilter = "workspace-1";
    store.state.actionCounts = { recent: 7 };

    store.clearLoadedViewData();

    expect(store.state.rows).toEqual([]);
    expect(store.state.total).toBe(0);
    expect(store.state.offset).toBe(0);
    expect(store.state.listVersion).toBe(0);
    expect(store.state.currentDomain).toBeNull();
    expect(store.state.selectedIndex).toBe(-1);
    expect(store.state.workspaceFilter).toBe("workspace-1");
    expect(store.state.actionCounts).toEqual({ recent: 7 });
  });

  it("tracks the chrome model version for rendered list windows", () => {
    const store = createNativePaletteState();

    store.commitListWindow({
      version: 42,
      view: "last-visited",
      offset: 0,
      limit: 1,
      total: 1,
      rows: [],
    }, true);

    expect(store.state.listVersion).toBe(42);

    store.replaceListWindow([], 0, -1);

    expect(store.state.listVersion).toBe(0);
  });

  it("resetToActions returns to the cold initial state", () => {
    const store = createNativePaletteState();
    store.state.currentView = "domains";
    store.state.workspaceFilter = "workspace-1";
    store.state.actionCounts = { recent: 7 };

    store.resetToActions();

    expect(store.state.currentView).toBe("actions");
    expect(store.state.workspaceFilter).toBe("all");
    expect(store.state.actionCounts).toEqual({});
  });
});
