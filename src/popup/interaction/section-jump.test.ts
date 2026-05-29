import { describe, expect, it } from "vitest";
import type { SelectionContext } from "./selection";
import { nextSectionJumpIndex } from "./section-jump";

function selection(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return {
    view: "actions",
    selectedIndex: 0,
    actionCount: 0,
    commandCount: 0,
    prefixCount: 0,
    navigationCount: 0,
    recentlyClosedCount: 0,
    workspaceCount: 0,
    containerCount: 0,
    folderCount: 0,
    profileRows: [],
    duplicateTabCount: 0,
    duplicatePromptCount: 0,
    duplicatePromptActionCount: 0,
    domainCloseConfirmCount: 0,
    rowCount: 0,
    isPrefixView: false,
    ...overrides,
  };
}

describe("section jump planning", () => {
  it("uses action sections in the actions view", () => {
    const next = nextSectionJumpIndex({
      view: "actions",
      selection: selection({ selectedIndex: 1 }),
      currentPage: 1,
      visibleItemCount: 5,
      actionSections: [
        { page: 1, items: ["a", "b"] },
        { page: 1, items: ["c"] },
        { page: 1, items: ["d", "e"] },
      ],
    }, 1);

    expect(next).toBe(2);
  });

  it("uses duplicate prompt sections in the duplicate prompt view", () => {
    const next = nextSectionJumpIndex({
      view: "duplicate-prompt",
      selection: selection({
        view: "duplicate-prompt",
        selectedIndex: 1,
        duplicatePromptActionCount: 4,
        duplicatePromptCount: 6,
      }),
      currentPage: 1,
      visibleItemCount: 0,
      actionSections: [],
    }, 1);

    expect(next).toBe(4);
  });

  it("ignores views without sections", () => {
    expect(nextSectionJumpIndex({
      view: "last-visited",
      selection: selection({ view: "last-visited" }),
      currentPage: 1,
      visibleItemCount: 0,
      actionSections: [],
    }, 1)).toBe(null);
  });
});
