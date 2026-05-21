import type { DuplicatePromptAction } from "./duplicate-prompt-options";
import type { InteractionCommand } from "./interpreter";

// Generic command dispatcher. The palette-specific runtime factory lives in
// native-palette-runtime.ts, where these handlers are wired to store/effect code.

type MaybePromise<T> = T | Promise<T>;

export type InteractionRuntimeHandlers = {
  runDuplicatePromptAction: (action: DuplicatePromptAction) => MaybePromise<void>;
  navigateHistoryDelta: (delta: 1 | -1) => MaybePromise<void>;
  cancel: () => MaybePromise<void>;
  back: () => MaybePromise<void>;
  moveSelection: (delta: 1 | -1) => MaybePromise<void>;
  moveSelectionDirectional: (delta: 1 | -1) => MaybePromise<void>;
  activateSelection: () => MaybePromise<void>;
  activateSelectionAndSwitch: () => MaybePromise<void>;
  activateRow: (index: number) => MaybePromise<void>;
  activateRowAndSwitch: (index: number) => MaybePromise<void>;
  cyclePage: (delta: 1 | -1) => MaybePromise<void>;
  jumpSection: (delta: 1 | -1) => MaybePromise<void>;
  closeSelection: () => MaybePromise<void>;
  closeAll: () => MaybePromise<void>;
  restoreSelectionKeepOpen: () => MaybePromise<void>;
  drillSelection: () => MaybePromise<void>;
  toggleSort: () => MaybePromise<void>;
  toggleWorkspaceFilter: () => MaybePromise<void>;
  filterWorkspaceIndex: (index: number) => MaybePromise<void>;
  switchWorkspaceIndex: (index: number) => MaybePromise<void>;
  openExtensionIndex: (index: number) => MaybePromise<void>;
};

export async function applyInteractionCommand(
  command: InteractionCommand,
  runtime: InteractionRuntimeHandlers,
) {
  switch (command.kind) {
    case "duplicate-prompt-action":
      await runtime.runDuplicatePromptAction(command.action);
      return;
    case "navigate-history-delta":
      await runtime.navigateHistoryDelta(command.delta);
      return;
    case "cancel":
      await runtime.cancel();
      return;
    case "back":
      await runtime.back();
      return;
    case "move-selection":
      await runtime.moveSelection(command.delta);
      return;
    case "move-selection-directional":
      await runtime.moveSelectionDirectional(command.delta);
      return;
    case "activate-selection":
      await runtime.activateSelection();
      return;
    case "activate-selection-and-switch":
      await runtime.activateSelectionAndSwitch();
      return;
    case "activate-row":
      await runtime.activateRow(command.index);
      return;
    case "activate-row-and-switch":
      await runtime.activateRowAndSwitch(command.index);
      return;
    case "cycle-page":
      await runtime.cyclePage(command.delta);
      return;
    case "jump-section":
      await runtime.jumpSection(command.delta);
      return;
    case "close-selection":
      await runtime.closeSelection();
      return;
    case "close-all":
      await runtime.closeAll();
      return;
    case "restore-selection-keep-open":
      await runtime.restoreSelectionKeepOpen();
      return;
    case "drill-selection":
      await runtime.drillSelection();
      return;
    case "toggle-sort":
      await runtime.toggleSort();
      return;
    case "toggle-workspace-filter":
      await runtime.toggleWorkspaceFilter();
      return;
    case "filter-workspace-index":
      await runtime.filterWorkspaceIndex(command.index);
      return;
    case "switch-workspace-index":
      await runtime.switchWorkspaceIndex(command.index);
      return;
    case "open-extension-index":
      await runtime.openExtensionIndex(command.index);
      return;
    case "none":
      return;
  }
}
