import { describe, expect, it } from "vitest";
import {
  duplicatePromptPreviewDomId,
  nextDuplicatePromptSectionIndex,
  nextSelectionIndex,
  selectionLength,
  type SelectionContext,
} from "./selection";

function context(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return {
    view: "actions",
    selectedIndex: -1,
    actionCount: 4,
    prefixCount: 0,
    navigationCount: 0,
    recentlyClosedCount: 0,
    workspaceCount: 0,
    containerCount: 0,
    folderCount: 0,
    profileRows: [],
    duplicateTabCount: 0,
    duplicatePromptCount: 4,
    duplicatePromptActionCount: 4,
    domainCloseConfirmCount: 3,
    rowCount: 0,
    isPrefixView: false,
    ...overrides,
  };
}

describe("selection transitions", () => {
  it("wraps selection through the active view length", () => {
    expect(nextSelectionIndex(context({ selectedIndex: -1 }), 1)).toBe(0);
    expect(nextSelectionIndex(context({ selectedIndex: 3 }), 1)).toBe(0);
    expect(nextSelectionIndex(context({ selectedIndex: 0 }), -1)).toBe(3);
  });

  it("uses the correct item count for each view family", () => {
    expect(selectionLength(context({ view: "actions", actionCount: 7 }))).toBe(7);
    expect(selectionLength(context({ view: "reorder-tabs", isPrefixView: true, prefixCount: 5 }))).toBe(5);
    expect(selectionLength(context({ view: "navigation", navigationCount: 2 }))).toBe(2);
    expect(selectionLength(context({ view: "move-to-folder", folderCount: 9 }))).toBe(9);
    expect(selectionLength(context({ view: "workspace-profiles", containerCount: 5 }))).toBe(5);
    expect(selectionLength(context({ view: "last-visited", rowCount: 80 }))).toBe(80);
    expect(selectionLength(context({ view: "duplicates", duplicateTabCount: 3 }))).toBe(3);
    expect(selectionLength(context({ view: "duplicate-prompt", duplicatePromptCount: 6 }))).toBe(6);
    expect(selectionLength(context({ view: "domain-close-confirm", domainCloseConfirmCount: 2 }))).toBe(2);
  });

  it("skips current profiles and returns no selection when none are launchable", () => {
    const profileRows = [
      { name: "current", isCurrent: true, isDefault: true },
      { name: "other", isCurrent: false, isDefault: false },
    ];
    expect(nextSelectionIndex(context({ view: "profiles", profileRows }), 1)).toBe(1);
    expect(nextSelectionIndex(context({ view: "profiles", selectedIndex: 1, profileRows }), 1)).toBe(1);
    expect(nextSelectionIndex(context({
      view: "profiles",
      profileRows: [{ name: "current", isCurrent: true, isDefault: true }],
    }), 1)).toBe(-1);
  });

  it("previews duplicate prompt action and row selections", () => {
    expect(duplicatePromptPreviewDomId("duplicate-prompt", 0, "tab-123", [], 4)).toBe("tab-123");
    expect(duplicatePromptPreviewDomId("duplicate-prompt", 1, "tab-123", [], 4)).toBeNull();
    expect(duplicatePromptPreviewDomId("duplicate-prompt", 4, "tab-123", ["tab-456"], 4)).toBe("tab-456");
    expect(duplicatePromptPreviewDomId("duplicate-prompt", 0, null)).toBeNull();
    expect(duplicatePromptPreviewDomId("actions", 0, "tab-123")).toBeNull();
  });

  it("tabs between duplicate prompt options and duplicate rows", () => {
    const prompt = context({ view: "duplicate-prompt", duplicatePromptCount: 6, duplicatePromptActionCount: 4 });
    expect(nextDuplicatePromptSectionIndex({ ...prompt, selectedIndex: -1 }, 1)).toBe(4);
    expect(nextDuplicatePromptSectionIndex({ ...prompt, selectedIndex: 1 }, 1)).toBe(4);
    expect(nextDuplicatePromptSectionIndex({ ...prompt, selectedIndex: 4 }, 1)).toBe(0);
    expect(nextDuplicatePromptSectionIndex({ ...prompt, selectedIndex: 4 }, -1)).toBe(0);
  });

  it("moves through duplicate group tab rows", () => {
    const duplicates = context({ view: "duplicates", duplicateTabCount: 2 });
    expect(nextSelectionIndex({ ...duplicates, selectedIndex: -1 }, 1)).toBe(0);
    expect(nextSelectionIndex({ ...duplicates, selectedIndex: 0 }, 1)).toBe(1);
    expect(nextSelectionIndex({ ...duplicates, selectedIndex: 1 }, 1)).toBe(0);
  });
});
