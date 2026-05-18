import { describe, expect, it } from "vitest";
import { applyInteractionCommand, type InteractionRuntimeHandlers } from "./runtime";

function createRuntime(calls: string[]): InteractionRuntimeHandlers {
  const record = (call: string) => {
    calls.push(call);
  };
  return {
    runAction: (actionId) => record(`action:${actionId}`),
    openView: (view) => record(`view:${view}`),
    runDuplicatePromptAction: (action) => record(`dup:${action}`),
    navigateHistoryDelta: (delta) => record(`history:${delta}`),
    cancel: () => record("cancel"),
    back: () => record("back"),
    moveSelection: (delta) => record(`move:${delta}`),
    moveSelectionDirectional: (delta) => record(`move-directional:${delta}`),
    activateSelection: () => record("activate-selection"),
    activateRow: (index) => record(`activate-row:${index}`),
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

describe("interaction runtime", () => {
  it("applies tree commands through injected side-effect handlers", async () => {
    const calls: string[] = [];
    const runtime = createRuntime(calls);

    await applyInteractionCommand({ kind: "action", actionId: "go-to-previous-tab", source: "view" }, runtime);
    await applyInteractionCommand({ kind: "open-view", view: "last-visited", source: "view" }, runtime);
    await applyInteractionCommand({ kind: "enter-prefix", view: "reorder-tabs", path: ["reorder-tabs"], source: "view" }, runtime);

    expect(calls).toEqual([
      "action:go-to-previous-tab",
      "view:last-visited",
      "view:reorder-tabs",
    ]);
  });

  it("applies structural commands through injected side-effect handlers", async () => {
    const calls: string[] = [];
    const runtime = createRuntime(calls);

    await applyInteractionCommand({ kind: "navigate-history-delta", delta: -1 }, runtime);
    await applyInteractionCommand({ kind: "move-selection", delta: 1 }, runtime);
    await applyInteractionCommand({ kind: "move-selection-directional", delta: -1 }, runtime);
    await applyInteractionCommand({ kind: "activate-row", index: 2 }, runtime);
    await applyInteractionCommand({ kind: "filter-workspace-index", index: 4 }, runtime);
    await applyInteractionCommand({ kind: "open-extension-index", index: 1 }, runtime);
    await applyInteractionCommand({ kind: "none" }, runtime);

    expect(calls).toEqual([
      "history:-1",
      "move:1",
      "move-directional:-1",
      "activate-row:2",
      "filter-workspace:4",
      "extension:1",
    ]);
  });
});
