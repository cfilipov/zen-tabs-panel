import { describe, expect, it } from "vitest";
import { interpretStructuralInput } from "./interpreter";

describe("interaction interpreter", () => {
  it("keeps structural navigation separate from chord tree actions", () => {
    expect(interpretStructuralInput({ kind: "key", key: "ArrowDown" }, { view: "actions" }))
      .toEqual({ kind: "move-selection", delta: 1 });
    expect(interpretStructuralInput({ kind: "key", key: "Backspace" }, { view: "last-visited" }))
      .toEqual({ kind: "back" });
    expect(interpretStructuralInput({ kind: "key", key: "Backspace" }, { view: "actions" }))
      .toEqual({ kind: "cancel" });
    expect(interpretStructuralInput({ kind: "key", key: "Backspace" }, { view: "duplicate-prompt" }))
      .toEqual({ kind: "cancel" });
    expect(interpretStructuralInput({ kind: "key", key: " " }, { view: "actions" }))
      .toEqual({ kind: "cycle-page", delta: 1 });
    expect(interpretStructuralInput({ kind: "key", key: "ArrowRight" }, { view: "actions" }))
      .toEqual({ kind: "move-selection-directional", delta: 1 });
    expect(interpretStructuralInput({ kind: "key", key: "ArrowLeft" }, { view: "reorder-tabs" }))
      .toEqual({ kind: "move-selection-directional", delta: -1 });
    expect(interpretStructuralInput({ kind: "key", key: "ArrowLeft" }, { view: "duplicate-prompt" }))
      .toEqual({ kind: "cancel" });
    expect(interpretStructuralInput({ kind: "key", key: "3" }, { view: "last-visited" }))
      .toEqual({ kind: "activate-row", index: 2 });
    expect(interpretStructuralInput({ kind: "key", key: "Enter" }, { view: "move-to-workspace" }))
      .toEqual({ kind: "activate-selection" });
    expect(interpretStructuralInput({ kind: "key", key: "Enter", shiftKey: true }, { view: "move-to-workspace" }))
      .toEqual({ kind: "activate-selection-and-switch" });
    expect(interpretStructuralInput({ kind: "key", key: "!", code: "Digit1", shiftKey: true }, { view: "move-to-folder" }))
      .toEqual({ kind: "activate-row-and-switch", index: 0 });
  });

  it("keeps list augmentation keys in the interpreter", () => {
    expect(interpretStructuralInput({ kind: "key", key: "w" }, { view: "last-visited" }))
      .toEqual({ kind: "close-selection" });
    expect(interpretStructuralInput({ kind: "key", key: "w" }, { view: "duplicates" }))
      .toEqual({ kind: "close-selection" });
    expect(interpretStructuralInput({ kind: "key", key: "w" }, { view: "domains" }))
      .toEqual({ kind: "close-selection" });
    expect(interpretStructuralInput({ kind: "key", key: "W", shiftKey: true }, { view: "child-tabs" }))
      .toEqual({ kind: "close-all" });
    expect(interpretStructuralInput({ kind: "key", key: "o" }, { view: "recently-closed" }))
      .toEqual({ kind: "restore-selection-keep-open" });
    expect(interpretStructuralInput({ kind: "key", key: "S" }, { view: "domains" }))
      .toEqual({ kind: "toggle-sort" });
    expect(interpretStructuralInput({ kind: "key", key: "s" }, { view: "last-visited" }))
      .toEqual({ kind: "open-search" });
    expect(interpretStructuralInput({ kind: "key", key: "s" }, { view: "tabs-by-age" }))
      .toEqual({ kind: "open-search" });
    expect(interpretStructuralInput({ kind: "key", key: "Backspace" }, { view: "last-visited", searchActive: true }))
      .toEqual({ kind: "dismiss-search" });
    expect(interpretStructuralInput({ kind: "key", key: "ArrowRight" }, { view: "parent-tabs" }))
      .toEqual({ kind: "drill-selection" });
  });

  it("keeps workspace filter shortcuts centralized for sidebar-backed views", () => {
    expect(interpretStructuralInput({ kind: "key", key: "0" }, { view: "domains" }))
      .toEqual({ kind: "toggle-workspace-filter" });
    expect(interpretStructuralInput({ kind: "key", key: "!", code: "Digit1", shiftKey: true }, { view: "duplicates" }))
      .toEqual({ kind: "filter-workspace-index", index: 0 });
    expect(interpretStructuralInput({ kind: "key", key: "0" }, { view: "recently-closed" }))
      .toEqual({ kind: "none" });
  });

  it("routes actions-menu dynamic row shortcuts through structural commands", () => {
    expect(interpretStructuralInput({ kind: "key", key: "3" }, { view: "actions" }))
      .toEqual({ kind: "switch-workspace-index", index: 2 });
    expect(interpretStructuralInput({ kind: "key", key: "@", code: "Digit2", shiftKey: true }, { view: "actions" }))
      .toEqual({ kind: "open-extension-index", index: 1 });
  });

  it("leaves command-palette text input keys to the focused input", () => {
    expect(interpretStructuralInput({ kind: "key", key: "s" }, { view: "command-palette" }))
      .toEqual({ kind: "none" });
    expect(interpretStructuralInput({ kind: "key", key: "Backspace" }, { view: "command-palette" }))
      .toEqual({ kind: "none" });
    expect(interpretStructuralInput({ kind: "key", key: "ArrowDown" }, { view: "command-palette" }))
      .toEqual({ kind: "move-selection", delta: 1 });
    expect(interpretStructuralInput({ kind: "key", key: "ArrowUp" }, { view: "command-palette" }))
      .toEqual({ kind: "move-selection", delta: -1 });
    expect(interpretStructuralInput({ kind: "key", key: "Enter" }, { view: "command-palette" }))
      .toEqual({ kind: "activate-selection" });
    expect(interpretStructuralInput({ kind: "key", key: "Escape" }, { view: "command-palette" }))
      .toEqual({ kind: "cancel" });
  });

  it("keeps special view hotkeys in the interpreter instead of components", () => {
    expect(interpretStructuralInput({ kind: "key", key: "b" }, { view: "navigation" }))
      .toEqual({ kind: "navigate-history-delta", delta: -1 });
    expect(interpretStructuralInput({ kind: "key", key: "f" }, { view: "navigation" }))
      .toEqual({ kind: "navigate-history-delta", delta: 1 });
    expect(interpretStructuralInput({ kind: "key", key: "1" }, { view: "duplicate-prompt" }))
      .toEqual({ kind: "duplicate-prompt-action", action: "duplicate-switch" });
    expect(interpretStructuralInput({ kind: "key", key: "s" }, { view: "duplicate-prompt" }))
      .toEqual({ kind: "none" });
    expect(interpretStructuralInput({ kind: "key", key: "o" }, { view: "duplicate-prompt" }))
      .toEqual({ kind: "duplicate-prompt-action", action: "duplicate-open-anyway" });
    expect(interpretStructuralInput({ kind: "key", key: "w" }, { view: "duplicate-prompt" }))
      .toEqual({ kind: "duplicate-prompt-action", action: "duplicate-open-and-close-others" });
    expect(interpretStructuralInput(
      { kind: "key", key: "w" },
      { view: "duplicate-prompt", selectedIndex: 4, duplicatePromptActionCount: 4 },
    )).toEqual({ kind: "close-selection" });
    expect(interpretStructuralInput({ kind: "key", key: "c" }, { view: "duplicate-prompt" }))
      .toEqual({ kind: "duplicate-prompt-action", action: "hide-palette" });
    expect(interpretStructuralInput({ kind: "key", key: "w" }, { view: "tab-info", tabInfoDuplicateCount: 2 }))
      .toEqual({ kind: "close-tab-info-others" });
    expect(interpretStructuralInput({ kind: "key", key: "w" }, { view: "tab-info", tabInfoDuplicateCount: 1 }))
      .toEqual({ kind: "none" });
  });

  it("routes domain-close confirmation hotkeys through the confirm view", () => {
    expect(interpretStructuralInput({ kind: "key", key: "w" }, { view: "domain-close-confirm" }))
      .toEqual({ kind: "domain-close-confirm-action", action: "close-unpinned" });
    expect(interpretStructuralInput(
      { kind: "key", key: "W", shiftKey: true },
      { view: "domain-close-confirm", domainClosePinnedCount: 2 },
    ))
      .toEqual({ kind: "domain-close-confirm-action", action: "close-including-pinned" });
    expect(interpretStructuralInput(
      { kind: "key", key: "W", shiftKey: true },
      { view: "domain-close-confirm", domainClosePinnedCount: 0 },
    ))
      .toEqual({ kind: "none" });
    expect(interpretStructuralInput({ kind: "key", key: "c" }, { view: "domain-close-confirm" }))
      .toEqual({ kind: "domain-close-confirm-action", action: "cancel" });
  });
});
