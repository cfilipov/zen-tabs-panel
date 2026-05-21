import { describe, expect, it } from "vitest";
import { previewPlan } from "./preview-plan";

describe("preview plan", () => {
  it("previews the selected tab-like row by priority", () => {
    expect(previewPlan({ view: "last-visited", selectedTabDomId: "tab-1" }))
      .toEqual({ kind: "preview", domId: "tab-1" });
    expect(previewPlan({
      view: "duplicates",
      selectedDuplicateTabDomId: "dup-1",
      selectedDuplicatePromptDomId: "prompt-1",
    })).toEqual({ kind: "preview", domId: "dup-1" });
    expect(previewPlan({ view: "duplicate-prompt", selectedDuplicatePromptDomId: "prompt-1" }))
      .toEqual({ kind: "preview", domId: "prompt-1" });
  });

  it("clears previews for empty views that own preview state", () => {
    expect(previewPlan({ view: "actions" })).toEqual({ kind: "clear" });
    expect(previewPlan({ view: "duplicates" })).toEqual({ kind: "clear" });
    expect(previewPlan({ view: "duplicate-prompt" })).toEqual({ kind: "clear" });
  });

  it("leaves other empty views alone", () => {
    expect(previewPlan({ view: "navigation" })).toEqual({ kind: "none" });
  });
});
