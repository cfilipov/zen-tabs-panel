import { describe, expect, it } from "vitest";
import { applyInteractionCommand, type InteractionRuntimeHandlers } from "./runtime";
import { createNativePaletteInteractionRuntime } from "./native-palette-runtime";

function createRuntime(calls: string[]): InteractionRuntimeHandlers {
  const record = (call: string) => {
    calls.push(call);
  };
  return {
    runDuplicatePromptAction: (action) => record(`dup:${action}`),
    runDomainCloseConfirmAction: (action) => record(`domain-close:${action}`),
    navigateHistoryDelta: (delta) => record(`history:${delta}`),
    cancel: () => record("cancel"),
    back: () => record("back"),
    moveSelection: (delta) => record(`move:${delta}`),
    moveSelectionDirectional: (delta) => record(`move-directional:${delta}`),
    activateSelection: () => record("activate-selection"),
    activateSelectionAndSwitch: () => record("activate-selection-switch"),
    activateRow: (index) => record(`activate-row:${index}`),
    activateRowAndSwitch: (index) => record(`activate-row-switch:${index}`),
    cyclePage: (delta) => record(`page:${delta}`),
    jumpSection: (delta) => record(`section:${delta}`),
    closeSelection: () => record("close-selection"),
    closeAll: () => record("close-all"),
    restoreSelectionKeepOpen: () => record("restore"),
    drillSelection: () => record("drill"),
    toggleSort: () => record("sort"),
    toggleWorkspaceFilter: () => record("workspace-filter"),
    filterWorkspaceIndex: (index) => record(`filter-workspace:${index}`),
    switchWorkspaceIndex: (index) => record(`switch-workspace:${index}`),
    openExtensionIndex: (index) => record(`extension:${index}`),
  };
}

function createNativeRuntime(
  calls: string[],
  overrides: Partial<Parameters<typeof createNativePaletteInteractionRuntime>[0]> = {},
) {
  const record = (call: string) => {
    calls.push(call);
  };
  return createNativePaletteInteractionRuntime({
    runDuplicatePromptAction: (action) => record(`dup:${action}`),
    runDomainCloseConfirmAction: (action) => record(`domain-close:${action}`),
    getNavigationHistory: () => null,
    navigateToHistoryIndex: (index) => record(`history-index:${index}`),
    cancel: () => record("cancel"),
    back: () => record("back"),
    moveSelection: (delta) => record(`move:${delta}`),
    moveSelectionDirectional: (delta) => record(`move-directional:${delta}`),
    activateSelection: () => record("activate-selection"),
    activateSelectionAndSwitch: () => record("activate-selection-switch"),
    activateRow: (index) => record(`activate-row:${index}`),
    activateRowAndSwitch: (index) => record(`activate-row-switch:${index}`),
    cyclePage: (delta) => record(`page:${delta}`),
    jumpSection: (delta) => record(`section:${delta}`),
    closeSelection: () => record("close-selection"),
    closeAll: () => record("close-all"),
    restoreSelectionKeepOpen: () => record("restore"),
    drillSelection: () => record("drill"),
    toggleSort: () => record("sort"),
    toggleWorkspaceFilter: () => record("workspace-filter"),
    filterWorkspaceIndex: (index) => record(`filter-workspace:${index}`),
    switchWorkspaceIndex: (index) => record(`switch-workspace:${index}`),
    openExtensionIndex: (index) => record(`extension:${index}`),
    ...overrides,
  });
}

describe("interaction runtime", () => {
  it("applies structural commands through injected side-effect handlers", async () => {
    const calls: string[] = [];
    const runtime = createRuntime(calls);

    await applyInteractionCommand({ kind: "navigate-history-delta", delta: -1 }, runtime);
    await applyInteractionCommand({ kind: "move-selection", delta: 1 }, runtime);
    await applyInteractionCommand({ kind: "move-selection-directional", delta: -1 }, runtime);
    await applyInteractionCommand({ kind: "activate-selection-and-switch" }, runtime);
    await applyInteractionCommand({ kind: "activate-row", index: 2 }, runtime);
    await applyInteractionCommand({ kind: "activate-row-and-switch", index: 3 }, runtime);
    await applyInteractionCommand({ kind: "domain-close-confirm-action", action: "close-unpinned" }, runtime);
    await applyInteractionCommand({ kind: "filter-workspace-index", index: 4 }, runtime);
    await applyInteractionCommand({ kind: "open-extension-index", index: 1 }, runtime);
    await applyInteractionCommand({ kind: "none" }, runtime);

    expect(calls).toEqual([
      "history:-1",
      "move:1",
      "move-directional:-1",
      "activate-selection-switch",
      "activate-row:2",
      "activate-row-switch:3",
      "domain-close:close-unpinned",
      "filter-workspace:4",
      "extension:1",
    ]);
  });

  it("resolves native history deltas from the current history snapshot", () => {
    const calls: string[] = [];
    const runtime = createNativeRuntime(calls, {
      getNavigationHistory: () => ({
        index: 1,
        entries: [
          { historyIndex: 4, title: "Older", url: "https://older.test" },
          { historyIndex: 5, title: "Current", url: "https://current.test" },
          { historyIndex: 8, title: "Newer", url: "https://newer.test" },
        ],
      }),
    });

    runtime.navigateHistoryDelta(-1);
    runtime.navigateHistoryDelta(1);

    expect(calls).toEqual(["history-index:0", "history-index:2"]);
  });
});
