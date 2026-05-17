import { describe, expect, it } from "vitest";
import type { TabIndexRow } from "../runtime/tab-index-client";
import { commandForViewActivation } from "./view-command";

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

describe("view activation commands", () => {
  it("maps tab, navigation, restore, and move activations to runtime messages", () => {
    expect(commandForViewActivation({ kind: "activate-tab", row: tabRow })).toEqual({
      kind: "message",
      clearReveal: true,
      message: { type: "activate-tab", domId: "tab-1" },
    });
    expect(commandForViewActivation({ kind: "navigate-history-index", index: 2 })).toEqual({
      kind: "message",
      clearReveal: true,
      message: { type: "navigate-to-history-index", index: 2 },
    });
    expect(commandForViewActivation({
      kind: "restore-closed-tab",
      row: { sessionId: "s1", title: "Closed", url: "", favIconUrl: "", pinned: false, lastModified: 1 },
    })).toEqual({
      kind: "message",
      clearReveal: true,
      message: { type: "restore-closed-tab", sessionId: "s1" },
    });
    expect(commandForViewActivation({
      kind: "move-to-workspace",
      row: { uuid: "ws-1", name: "Work", svgContent: "", isActive: false },
    })).toEqual({
      kind: "message",
      clearReveal: true,
      message: { type: "move-selected-tabs-to-workspace", workspaceId: "ws-1" },
    });
  });

  it("maps secondary row activations and skips current profile launch", () => {
    expect(commandForViewActivation({
      kind: "reopen-in-container",
      row: { cookieStoreId: "firefox-container-1", userContextId: 1, name: "Work", colorCode: "#00f", iconUrl: "" },
    })).toEqual({
      kind: "message",
      clearReveal: true,
      message: { type: "reopen-in-container", userContextId: 1 },
    });
    expect(commandForViewActivation({
      kind: "move-to-folder",
      row: { id: "folder-1", name: "Folder", workspaceId: null },
    })).toEqual({
      kind: "message",
      clearReveal: true,
      message: { type: "move-tab-to-folder", folderId: "folder-1" },
    });
    expect(commandForViewActivation({
      kind: "launch-profile",
      row: { name: "Work", isCurrent: false, isDefault: false },
    })).toEqual({
      kind: "message",
      clearReveal: true,
      message: { type: "launch-profile", name: "Work" },
    });
    expect(commandForViewActivation({
      kind: "launch-profile",
      row: { name: "Current", isCurrent: true, isDefault: false },
    })).toEqual({ kind: "none" });
  });

  it("keeps local UI activations distinct from runtime messages", () => {
    expect(commandForViewActivation({
      kind: "activate-domain",
      row: { kind: "domain", domain: "example.test", count: 2 },
    })).toEqual({ kind: "open-domain", domain: "example.test" });
    expect(commandForViewActivation({
      kind: "duplicate-prompt-action",
      action: "duplicate-open-anyway",
    })).toEqual({ kind: "duplicate-prompt-action", action: "duplicate-open-anyway" });
    expect(commandForViewActivation({ kind: "none" })).toEqual({ kind: "none" });
  });
});
