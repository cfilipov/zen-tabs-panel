import { describe, expect, it } from "vitest";
import { closeSelectionPlan, type CloseSelectionContext } from "./close-plan";

function context(overrides: Partial<CloseSelectionContext> = {}): CloseSelectionContext {
  return {
    view: "last-visited",
    hasSelectedDuplicateTab: false,
    hasSelectedDuplicatePromptTab: false,
    hasSelectedTabRow: false,
    ...overrides,
  };
}

describe("close selection plan", () => {
  it("routes duplicate views to their specialized close handlers", () => {
    expect(closeSelectionPlan(context({ view: "duplicates", hasSelectedDuplicateTab: true })))
      .toEqual({ kind: "duplicate-tab" });
    expect(closeSelectionPlan(context({ view: "duplicate-prompt", hasSelectedDuplicatePromptTab: true })))
      .toEqual({ kind: "duplicate-prompt-tab" });
  });

  it("routes regular tab rows to the native tab close path", () => {
    expect(closeSelectionPlan(context({ view: "last-visited", hasSelectedTabRow: true })))
      .toEqual({ kind: "native-tab-row" });
  });

  it("ignores empty selections", () => {
    expect(closeSelectionPlan(context({ view: "duplicates" }))).toEqual({ kind: "none" });
    expect(closeSelectionPlan(context({ view: "tab-info" }))).toEqual({ kind: "none" });
  });
});
