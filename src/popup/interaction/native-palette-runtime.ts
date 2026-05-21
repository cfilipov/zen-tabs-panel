import type { NavigationHistory } from "../runtime/history-client";
import type { DuplicatePromptAction } from "./duplicate-prompt-options";
import type { InteractionRuntimeHandlers } from "./runtime";

export type NativePaletteRuntimeDeps = {
  runDuplicatePromptAction: (action: DuplicatePromptAction) => Promise<void> | void;
  getNavigationHistory: () => NavigationHistory | null;
  navigateToHistoryIndex: (index: number) => Promise<void> | void;
  cancel: () => Promise<void> | void;
  back: () => Promise<void> | void;
  moveSelection: (delta: 1 | -1) => Promise<void> | void;
  moveSelectionDirectional: (delta: 1 | -1) => Promise<void> | void;
  activateSelection: () => Promise<void> | void;
  activateSelectionAndSwitch: () => Promise<void> | void;
  activateRow: (index: number) => Promise<void> | void;
  activateRowAndSwitch: (index: number) => Promise<void> | void;
  cyclePage: (delta: 1 | -1) => Promise<void> | void;
  jumpSection: (delta: 1 | -1) => Promise<void> | void;
  closeSelection: () => Promise<void> | void;
  closeAll: () => Promise<void> | void;
  restoreSelectionKeepOpen: () => Promise<void> | void;
  drillSelection: () => Promise<void> | void;
  toggleSort: () => Promise<void> | void;
  toggleWorkspaceFilter: () => Promise<void> | void;
  filterWorkspaceIndex: (index: number) => Promise<void> | void;
  switchWorkspaceIndex: (index: number) => Promise<void> | void;
  openExtensionIndex: (index: number) => Promise<void> | void;
};

function navigateHistoryDelta(deps: NativePaletteRuntimeDeps, delta: 1 | -1) {
  const history = deps.getNavigationHistory();
  const current = history?.index ?? -1;
  const target = current + delta;
  if (target >= 0 && target < (history?.entries.length ?? 0)) {
    void deps.navigateToHistoryIndex(target);
  }
}

export function createNativePaletteInteractionRuntime(deps: NativePaletteRuntimeDeps): InteractionRuntimeHandlers {
  return {
    runDuplicatePromptAction: deps.runDuplicatePromptAction,
    navigateHistoryDelta: (delta) => navigateHistoryDelta(deps, delta),
    cancel: deps.cancel,
    back: deps.back,
    moveSelection: deps.moveSelection,
    moveSelectionDirectional: deps.moveSelectionDirectional,
    activateSelection: deps.activateSelection,
    activateSelectionAndSwitch: deps.activateSelectionAndSwitch,
    activateRow: deps.activateRow,
    activateRowAndSwitch: deps.activateRowAndSwitch,
    cyclePage: deps.cyclePage,
    jumpSection: deps.jumpSection,
    closeSelection: deps.closeSelection,
    closeAll: deps.closeAll,
    restoreSelectionKeepOpen: deps.restoreSelectionKeepOpen,
    drillSelection: deps.drillSelection,
    toggleSort: deps.toggleSort,
    toggleWorkspaceFilter: deps.toggleWorkspaceFilter,
    filterWorkspaceIndex: deps.filterWorkspaceIndex,
    switchWorkspaceIndex: deps.switchWorkspaceIndex,
    openExtensionIndex: deps.openExtensionIndex,
  };
}
