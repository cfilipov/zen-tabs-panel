import { describe, expect, it } from "vitest";
import type { TabIndexRow } from "../runtime/tab-index-client";
import {
  resolveDuplicatePromptActivation,
  resolveDuplicatePromptSelectionActivation,
  type DuplicatePromptActivationContext,
} from "./view-activation";

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

function context(overrides: Partial<DuplicatePromptActivationContext> = {}): DuplicatePromptActivationContext {
  return {
    selectedIndex: -1,
    duplicatePromptTabs: [],
    ...overrides,
  };
}

describe("view activation resolver", () => {
  it("resolves duplicate prompt option rows locally", () => {
    expect(resolveDuplicatePromptActivation(context(), 0, "shortcut"))
      .toEqual({ kind: "duplicate-prompt-action", action: "duplicate-switch" });
    expect(resolveDuplicatePromptSelectionActivation(context({ selectedIndex: 1 })))
      .toEqual({ kind: "duplicate-prompt-action", action: "duplicate-open-anyway" });
    expect(resolveDuplicatePromptSelectionActivation(context({ selectedIndex: 2 })))
      .toEqual({ kind: "duplicate-prompt-action", action: "duplicate-open-and-close-others" });
  });

  it("returns duplicate prompt tab rows for chrome activation", () => {
    expect(resolveDuplicatePromptSelectionActivation(context({ selectedIndex: 4, duplicatePromptTabs: [tabRow] })))
      .toEqual({ kind: "activate-tab", row: tabRow, rowIndex: 0 });
    expect(resolveDuplicatePromptActivation(context({ duplicatePromptTabs: [tabRow, { ...tabRow, domId: "tab-2" }] }), 1, "shortcut"))
      .toEqual({ kind: "activate-tab", row: { ...tabRow, domId: "tab-2" }, rowIndex: 1 });
  });
});
