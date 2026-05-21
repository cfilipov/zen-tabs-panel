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

  it("removes blank new-tab entries from navigation history while preserving browser indexes", async () => {
    const result = await loadNavigationView({
      getNavigationHistory: async () => ({
        index: 2,
        entries: [
          { title: "New Tab", url: "about:newtab" },
          { title: "Back", url: "https://back.test" },
          { title: "Current", url: "https://current.test" },
          { title: "Blank", url: "about:blank" },
        ],
      }),
      getRecentlyClosed: async () => [],
    });

    expect(result.selectedIndex).toBe(1);
    expect(result.history?.entries.map((entry) => entry.title)).toEqual(["Back", "Current"]);
    expect(result.history?.entries.map((entry) => entry.historyIndex)).toEqual([1, 2]);
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

  it("loads the chrome-owned workspace model", async () => {
    const result = await loadMoveToWorkspaceView({
      getWorkspacesViewModel: async () => ({
        version: 3,
        view: "move-to-workspace",
        rows: [
          { uuid: "main", name: "Main", svgContent: "", isActive: true, tabCount: 4, chordKey: "1" },
        ],
        selectedIndex: -1,
        model: {
          id: "workspaces",
          view: "move-to-workspace",
          rowIntents: [{
            rowId: "main",
            index: 0,
            chordKey: "1",
            shiftedChordKey: "Shift+1",
            action: "move-selected-tabs-to-workspace",
            disabled: true,
          }],
        },
      }),
    });

    expect(result.version).toBe(3);
    expect(result.rows[0]?.tabCount).toBe(4);
    expect(result.model!.rowIntents[0]?.rowId).toBe("main");
  });

  it("loads chrome-owned container and profile models", async () => {
    const containers = await loadOpenInContainerView({
      getContainersViewModel: async () => ({
        version: 2,
        view: "open-in-container",
        rows: [{
          cookieStoreId: "firefox-container-1",
          userContextId: 1,
          name: "Work",
          colorCode: "#00f",
          iconUrl: "",
        }],
        selectedIndex: -1,
        model: {
          id: "containers",
          view: "open-in-container",
          rowIntents: [{ rowId: "1", index: 0, chordKey: "1", action: "reopen-in-container" }],
        },
      }),
    });
    const profiles = await loadProfilesView({
      getProfilesViewModel: async () => ({
        version: 4,
        view: "profiles",
        rows: [{ name: "default", isCurrent: true, isDefault: true }],
        selectedIndex: -1,
        model: {
          id: "profiles",
          view: "profiles",
          rowIntents: [{ rowId: "default", index: 0, chordKey: "1", action: "launch-profile", disabled: true }],
        },
      }),
    });

    expect(containers.version).toBe(2);
    expect(containers.model!.rowIntents[0]?.action).toBe("reopen-in-container");
    expect(profiles.version).toBe(4);
    expect(profiles.model!.rowIntents[0]?.disabled).toBe(true);
  });

  it("loads the chrome-owned folder model", async () => {
    const result = await loadMoveToFolderView(
      {
        getFoldersViewModel: async () => ({
          version: 5,
          view: "move-to-folder",
          rows: [{ id: "f1", name: "Folder", workspaceId: "ws-1" }],
          selectedIndex: -1,
          model: {
            id: "folders",
            view: "move-to-folder",
            rowIntents: [{
              rowId: "f1",
              index: 0,
              chordKey: "1",
              shiftedChordKey: "Shift+1",
              action: "move-tab-to-folder",
            }],
          },
        }),
      },
      { getWorkspacesWithIcons: async () => [{ uuid: "ws-1", name: "Main", svgContent: "", isActive: false }] },
    );

    expect(result.version).toBe(5);
    expect(result.folders[0]?.id).toBe("f1");
    expect(result.workspaces[0]?.uuid).toBe("ws-1");
    expect(result.model?.rowIntents[0]?.shiftedChordKey).toBe("Shift+1");
  });
});
