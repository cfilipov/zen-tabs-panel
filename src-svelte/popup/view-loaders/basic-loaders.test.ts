import { describe, expect, it } from "vitest";
import {
  loadMoveToFolderView,
  loadMoveToWorkspaceView,
  loadNavigationView,
  loadOpenInContainerView,
  loadProfilesView,
  loadRecentlyClosedView,
} from "./basic-loaders";

describe("basic view loaders", () => {
  it("loads navigation history with the current history index selected", async () => {
    const result = await loadNavigationView({
      getNavigationHistory: async () => ({
        index: 1,
        entries: [
          { title: "A", url: "https://a.test" },
          { title: "B", url: "https://b.test" },
        ],
      }),
      getRecentlyClosed: async () => [],
    });

    expect(result.selectedIndex).toBe(1);
    expect(result.history?.entries).toHaveLength(2);
  });

  it("normalizes an empty navigation history to no selection", async () => {
    const result = await loadNavigationView({
      getNavigationHistory: async () => null,
      getRecentlyClosed: async () => [],
    });

    expect(result).toEqual({ history: null, selectedIndex: -1 });
  });

  it("loads recently closed rows", async () => {
    const result = await loadRecentlyClosedView({
      getNavigationHistory: async () => null,
      getRecentlyClosed: async () => [{
        sessionId: "s1",
        title: "Closed",
        url: "https://closed.test",
        favIconUrl: "",
        pinned: false,
        lastModified: 12,
      }],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.selectedIndex).toBe(-1);
  });

  it("excludes the active workspace from move targets", async () => {
    const result = await loadMoveToWorkspaceView({
      getWorkspacesWithIcons: async () => [
        { uuid: "active", name: "Active", svgContent: "", isActive: true },
        { uuid: "other", name: "Other", svgContent: "", isActive: false },
      ],
    });

    expect(result.rows.map((row) => row.uuid)).toEqual(["other"]);
  });

  it("loads containers and profiles", async () => {
    const containers = await loadOpenInContainerView({
      getContainers: async () => [{
        cookieStoreId: "firefox-container-1",
        userContextId: 1,
        name: "Work",
        colorCode: "#00f",
        iconUrl: "",
      }],
    });
    const profiles = await loadProfilesView({
      getProfiles: async () => [{
        name: "default",
        isCurrent: true,
        isDefault: true,
      }],
    });

    expect(containers.rows[0]?.name).toBe("Work");
    expect(profiles.rows[0]?.isCurrent).toBe(true);
  });

  it("loads folders and treats workspace-icon failures as optional", async () => {
    const result = await loadMoveToFolderView(
      { getFolders: async () => [{ id: "f1", name: "Folder", workspaceId: null }] },
      { getWorkspacesWithIcons: async () => { throw new Error("no icons"); } },
    );

    expect(result.folders).toEqual([{ id: "f1", name: "Folder", workspaceId: null }]);
    expect(result.workspaces).toEqual([]);
  });
});
