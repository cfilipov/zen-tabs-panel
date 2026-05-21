import type { ViewId } from "../../shared/types";
import type { ActionEffectId } from "../../shared/navigation-tree";
import type { DuplicatePromptAction } from "../interaction/duplicate-prompt-options";
import { chromeNavigationMessage } from "../interaction/view-navigation";
import { fireMessage, sendMessage } from "./ipc";

export type ActivateViewRowResult =
  | boolean
  | { kind: "open-view"; view: ViewId; params?: Record<string, unknown> };

export function createPaletteEffects() {
  return {
    revealPalette(inst: number) {
      fireMessage({ type: "reveal-palette", inst });
    },
    hidePalette() {
      fireMessage({ type: "hide-palette" });
    },
    notifyChromeView(view: ViewId, params?: URLSearchParams | Record<string, unknown>) {
      fireMessage(chromeNavigationMessage(view, params));
    },
    navigateBack() {
      return sendMessage<{ view: ViewId; params?: Record<string, unknown> } | null>({ type: "navigate-back" });
    },
    getSelectedTabDomIds() {
      return sendMessage<string[]>({ type: "get-selected-tab-dom-ids" });
    },
    runAction(actionId: ActionEffectId) {
      fireMessage({ type: actionId });
    },
    activateTab(domId: string) {
      fireMessage({ type: "activate-tab", domId });
    },
    activateViewRow(
      view: ViewId,
      index: number,
      source: "selection" | "shortcut",
      switchToTarget = false,
      listVersion?: number,
      expectedDomId?: string,
      expectedRowId?: string,
    ) {
      return sendMessage<ActivateViewRowResult>({
        type: "activate-view-row",
        view,
        index,
        source,
        ...(switchToTarget ? { switchToTarget: true } : {}),
        ...(typeof listVersion === "number" && listVersion > 0 ? { listVersion } : {}),
        ...(expectedDomId ? { expectedDomId } : {}),
        ...(expectedRowId ? { expectedRowId } : {}),
      });
    },
    activateCurrentViewRow(
      index: number,
      source: "selection" | "shortcut",
      switchToTarget = false,
      listVersion?: number,
    ) {
      return sendMessage<ActivateViewRowResult>({
        type: "activate-current-view-row",
        index,
        source,
        ...(switchToTarget ? { switchToTarget: true } : {}),
        ...(typeof listVersion === "number" && listVersion > 0 ? { listVersion } : {}),
      });
    },
    synthChordKey(chordKey: string, view: ViewId, activation = "keydown") {
      fireMessage({ type: "synth-chord-key", chordKey, view, activation });
    },
    recordCurrentViewChordKey(chordKey: string, activation = "trace") {
      fireMessage({ type: "record-current-view-chord-key", chordKey, activation });
    },
    bridgeDispatchSettled(inst: number | null) {
      fireMessage({ type: "bridge-dispatch-settled", inst });
    },
    navigateToHistoryIndex(index: number) {
      fireMessage({ type: "navigate-to-history-index", index });
    },
    restoreClosedTab(sessionId: string, keepOpen = false) {
      fireMessage({
        type: keepOpen ? "restore-closed-tab-keep-open" : "restore-closed-tab",
        sessionId,
      });
    },
    moveSelectedTabsToWorkspace(workspaceId: string, switchToTarget = false) {
      fireMessage({
        type: "move-selected-tabs-to-workspace",
        workspaceId,
        ...(switchToTarget ? { switchToTarget: true } : {}),
      });
    },
    reopenInContainer(userContextId: number) {
      fireMessage({ type: "reopen-in-container", userContextId });
    },
    moveTabToFolder(folderId: string, switchToTarget = false) {
      fireMessage({
        type: "move-tab-to-folder",
        folderId,
        ...(switchToTarget ? { switchToTarget: true } : {}),
      });
    },
    launchProfile(name: string) {
      fireMessage({ type: "launch-profile", name });
    },
    switchWorkspaceByIndex(index: number) {
      return sendMessage<boolean>({ type: "switch-workspace-by-index", index });
    },
    openExtensionPopupByIndex(index: number) {
      return sendMessage<boolean>({ type: "open-extension-popup-by-index", index });
    },
    closeTab(domId: string) {
      fireMessage({ type: "close-tab", domId });
    },
    closeTabAndWait(domId: string) {
      return sendMessage({ type: "close-tab", domId });
    },
    runDuplicatePromptAction(action: DuplicatePromptAction) {
      fireMessage({ type: action });
    },
    previewTab(domId: string) {
      fireMessage({ type: "preview-tab", domId });
    },
    clearPreview() {
      fireMessage({ type: "clear-preview" });
    },
    sendViewCommand(message: Record<string, unknown>) {
      fireMessage(message);
    },
    resizePanel(view: ViewId, height: number, dynamicSidebarWidth?: number, inst?: number | null) {
      return sendMessage({
        type: "resize-panel",
        view,
        height,
        dynamicSidebarWidth,
        ...(typeof inst === "number" ? { inst } : {}),
      });
    },
    popupReady<T>(message: unknown) {
      return sendMessage<T>(message);
    },
  };
}
