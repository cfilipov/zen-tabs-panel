import { describe, expect, it } from "vitest";
import type { StableRowIdentityContext } from "./row-identity";
import {
  navigationEntryForShortcutIndex,
  stableRowIdForActivation,
} from "./row-identity";

function context(overrides: Partial<StableRowIdentityContext> = {}): StableRowIdentityContext {
  return {
    view: "actions",
    offset: 0,
    navigationHistory: null,
    recentlyClosedRows: [],
    duplicateTabs: [],
    rows: [],
    workspaceRows: [],
    containerRows: [],
    folderRows: [],
    profileRows: [],
    ...overrides,
  };
}

describe("stable row identity", () => {
  it("resolves navigation shortcuts against non-current history entries", () => {
    const history = {
      index: 1,
      entries: [
        { url: "https://one.test", title: "One", historyIndex: 10 },
        { url: "https://current.test", title: "Current", historyIndex: 11 },
        { url: "https://two.test", title: "Two", historyIndex: 12 },
      ],
    };

    expect(navigationEntryForShortcutIndex(history, 0)?.entry.title).toBe("One");
    expect(navigationEntryForShortcutIndex(history, 1)?.entry.title).toBe("Two");
    expect(stableRowIdForActivation(context({ view: "navigation", navigationHistory: history }), 1, "shortcut"))
      .toBe("12");
  });

  it("resolves windowed native list shortcut and selection ids", () => {
    const rows = [
      { kind: "tab", domId: "tab-20" },
      { kind: "domain", domain: "example.test" },
    ] as unknown as StableRowIdentityContext["rows"];

    const base = context({ view: "last-visited", offset: 20, rows });

    expect(stableRowIdForActivation(base, 0, "shortcut")).toBe("tab-20");
    expect(stableRowIdForActivation(base, 21, "selection")).toBe("example.test");
  });

  it("resolves chrome-owned model row ids", () => {
    expect(stableRowIdForActivation(context({
      view: "duplicates",
      duplicateTabs: [{ domId: "dup-1" } as never],
    }), 0, "shortcut")).toBe("dup-1");
    expect(stableRowIdForActivation(context({
      view: "recently-closed",
      recentlyClosedRows: [{ sessionId: "session-1" } as never],
    }), 0, "shortcut")).toBe("session-1");
    expect(stableRowIdForActivation(context({
      view: "move-to-workspace",
      workspaceRows: [{ uuid: "workspace-1" } as never],
    }), 0, "shortcut")).toBe("workspace-1");
    expect(stableRowIdForActivation(context({
      view: "open-in-container",
      containerRows: [{ userContextId: 4 } as never],
    }), 0, "shortcut")).toBe("4");
    expect(stableRowIdForActivation(context({
      view: "workspace-profiles",
      containerRows: [{ userContextId: 0 } as never],
    }), 0, "shortcut")).toBe("0");
    expect(stableRowIdForActivation(context({
      view: "move-to-folder",
      folderRows: [{ id: "folder-1" } as never],
    }), 0, "shortcut")).toBe("folder-1");
    expect(stableRowIdForActivation(context({
      view: "profiles",
      profileRows: [{ name: "Default" } as never],
    }), 0, "shortcut")).toBe("Default");
  });

  it("returns null for invalid indexes and unsupported views", () => {
    expect(stableRowIdForActivation(context({ view: "actions" }), 0, "shortcut")).toBe(null);
    expect(stableRowIdForActivation(context({ view: "last-visited" }), -1, "shortcut")).toBe(null);
    expect(stableRowIdForActivation(context({ view: "last-visited" }), 99, "shortcut")).toBe(null);
  });
});
