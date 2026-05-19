import { describe, expect, it } from "vitest";
import type { DomainIndexRow, TabIndexRow } from "../runtime/tab-index-client";
import { resolveSelectionActivation, resolveViewActivation, type ViewActivationContext } from "./view-activation";

const tabRow: TabIndexRow = {
  index: 0,
  id: null,
  domId: "tab-1",
  title: "Tab",
  url: "https://example.test",
  domain: "example.test",
  workspaceId: null,
  pinned: false,
  essential: false,
  active: false,
  lastAccessed: 0,
  favIconUrl: "",
  unread: false,
  openerTabDomId: null,
  splitView: false,
  splitGroupId: null,
  pending: false,
  panelTabUuid: null,
  panelParentUuid: null,
};

const domainRow: DomainIndexRow = { kind: "domain", domain: "example.test", count: 2 };

function context(overrides: Partial<ViewActivationContext> = {}): ViewActivationContext {
  return {
    view: "last-visited",
    selectedIndex: -1,
    offset: 0,
    rows: [],
    navigationHistory: null,
    recentlyClosedRows: [],
    workspaceRows: [],
    containerRows: [],
    folderRows: [],
    profileRows: [],
    ...overrides,
  };
}

describe("view activation resolver", () => {
  it("resolves selected tab and domain rows from the loaded window", () => {
    expect(resolveSelectionActivation(context({ selectedIndex: 5, offset: 5, rows: [tabRow] })))
      .toEqual({ kind: "activate-tab", row: tabRow });
    expect(resolveSelectionActivation(context({ view: "domains", selectedIndex: 2, offset: 2, rows: [domainRow] })))
      .toEqual({ kind: "activate-domain", row: domainRow });
  });

  it("resolves digit shortcuts relative to the visible list window", () => {
    expect(resolveViewActivation(context({ offset: 80, rows: [tabRow] }), 0, "shortcut"))
      .toEqual({ kind: "activate-tab", row: tabRow });
    expect(resolveViewActivation(context({ view: "domains", offset: 80, rows: [domainRow] }), 0, "shortcut"))
      .toEqual({ kind: "activate-domain", row: domainRow });
  });

  it("keeps navigation selection absolute but digit shortcuts relative to visible badges", () => {
    const navigationHistory = {
      index: 1,
      entries: [
        { title: "Back", url: "https://back.test" },
        { title: "Current", url: "https://current.test" },
        { title: "Forward", url: "https://forward.test" },
      ],
    };

    expect(resolveSelectionActivation(context({ view: "navigation", selectedIndex: 0, navigationHistory })))
      .toEqual({ kind: "navigate-history-index", index: 0 });
    expect(resolveSelectionActivation(context({ view: "navigation", selectedIndex: 1, navigationHistory })))
      .toEqual({ kind: "none" });
    expect(resolveViewActivation(context({ view: "navigation", navigationHistory }), 1, "shortcut"))
      .toEqual({ kind: "navigate-history-index", index: 2 });
  });

  it("uses original browser history indexes after blank entries are filtered out", () => {
    const navigationHistory = {
      index: 1,
      entries: [
        { title: "Back", url: "https://back.test", historyIndex: 3 },
        { title: "Current", url: "https://current.test", historyIndex: 5 },
        { title: "Forward", url: "https://forward.test", historyIndex: 7 },
      ],
    };

    expect(resolveSelectionActivation(context({ view: "navigation", selectedIndex: 0, navigationHistory })))
      .toEqual({ kind: "navigate-history-index", index: 3 });
    expect(resolveViewActivation(context({ view: "navigation", navigationHistory }), 1, "shortcut"))
      .toEqual({ kind: "navigate-history-index", index: 7 });
  });

  it("resolves static list views and duplicate prompt actions", () => {
    const closed = { sessionId: "s1", title: "Closed", url: "", favIconUrl: "", pinned: false, lastModified: 1 };
    const workspace = { uuid: "ws", name: "Work", svgContent: "", isActive: false };
    const container = { cookieStoreId: "firefox-container-1", userContextId: 1, name: "Work", colorCode: "#00f", iconUrl: "" };
    const folder = { id: "folder", name: "Folder", workspaceId: null };
    const profile = { name: "Profile", isCurrent: false, isDefault: false };

    expect(resolveViewActivation(context({ view: "recently-closed", recentlyClosedRows: [closed] }), 0, "shortcut"))
      .toEqual({ kind: "restore-closed-tab", row: closed });
    expect(resolveViewActivation(context({ view: "move-to-workspace", workspaceRows: [workspace] }), 0, "shortcut"))
      .toEqual({ kind: "move-to-workspace", row: workspace });
    expect(resolveViewActivation(context({ view: "open-in-container", containerRows: [container] }), 0, "shortcut"))
      .toEqual({ kind: "reopen-in-container", row: container });
    expect(resolveViewActivation(context({ view: "move-to-folder", folderRows: [folder] }), 0, "shortcut"))
      .toEqual({ kind: "move-to-folder", row: folder });
    expect(resolveViewActivation(context({ view: "profiles", profileRows: [profile] }), 0, "shortcut"))
      .toEqual({ kind: "launch-profile", row: profile });
    expect(resolveViewActivation(context({ view: "duplicate-prompt" }), 1, "shortcut"))
      .toEqual({ kind: "duplicate-prompt-action", action: "duplicate-open-anyway" });
    expect(resolveViewActivation(context({ view: "duplicate-prompt" }), 2, "shortcut"))
      .toEqual({ kind: "duplicate-prompt-action", action: "duplicate-open-and-close-others" });
  });
});
