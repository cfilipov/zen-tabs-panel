import { describe, expect, it } from "vitest";
import { loadDuplicateGroupsView } from "./duplicates-loader";

describe("duplicates loader", () => {
  it("loads the chrome-owned duplicate groups model", async () => {
    const result = await loadDuplicateGroupsView(
      {
        getDuplicateGroupsViewModel: async (workspaceFilter = "all") => ({
          version: 6,
          view: "duplicates",
          groups: [{
            kind: "duplicate-group",
            url: "https://example.test",
            title: "Example",
            domain: "example.test",
            favIconUrl: "",
            tabs: [],
          }],
          workspaces: [{ uuid: "ws-1", name: "One", svgContent: "", isActive: true }],
          workspaceFilter,
          selectedIndex: -1,
          model: { id: "duplicates", view: "duplicates", rowIntents: [] },
        }),
      },
      { getWorkspacesWithIcons: async () => { throw new Error("fallback should not run"); } },
      "ws-1",
    );

    expect(result.version).toBe(6);
    expect(result.groups).toHaveLength(1);
    expect(result.workspaceFilter).toBe("ws-1");
  });
});
