import { describe, expect, it } from "vitest";
import { loadDuplicateGroupsView } from "./duplicates-loader";

describe("duplicates loader", () => {
  it("loads duplicate groups through the tab index without requesting all tabs", async () => {
    const calls: unknown[] = [];
    const result = await loadDuplicateGroupsView(
      {
        getDuplicateGroups: async (params = {}) => {
          calls.push(params);
          return [{
            kind: "duplicate-group",
            url: "https://example.test",
            title: "Example",
            domain: "example.test",
            favIconUrl: "",
            tabs: [],
          }];
        },
      },
      {
        getWorkspacesWithIcons: async () => [{ uuid: "ws-1", name: "One", svgContent: "", isActive: true }],
      },
      "ws-1",
    );

    expect(calls).toEqual([{ workspaceId: "ws-1" }]);
    expect(result.groups).toHaveLength(1);
    expect(result.workspaceFilter).toBe("ws-1");
    expect(result.selectedIndex).toBe(-1);
  });

  it("falls back to all workspaces when the saved workspace filter is stale", async () => {
    const calls: unknown[] = [];
    const result = await loadDuplicateGroupsView(
      {
        getDuplicateGroups: async (params = {}) => {
          calls.push(params);
          return [];
        },
      },
      {
        getWorkspacesWithIcons: async () => [{ uuid: "ws-2", name: "Two", svgContent: "", isActive: false }],
      },
      "missing",
    );

    expect(calls).toEqual([{}]);
    expect(result.workspaceFilter).toBe("all");
  });

  it("treats missing workspace icons as optional", async () => {
    const result = await loadDuplicateGroupsView(
      { getDuplicateGroups: async () => [] },
      { getWorkspacesWithIcons: async () => { throw new Error("icons unavailable"); } },
      "all",
    );

    expect(result.workspaces).toEqual([]);
  });
});
