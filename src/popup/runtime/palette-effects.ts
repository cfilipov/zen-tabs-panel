import type { ViewId } from "../../shared/types";
import type { DuplicatePromptAction } from "../interaction/duplicate-prompt-options";
import { chromeNavigationMessage } from "../interaction/view-navigation";
import { fireMessage, sendMessage } from "./ipc";

export type ActivateViewRowResult =
  | { kind: "open-view"; view: ViewId; params?: Record<string, unknown> }
  | { kind: "terminal" }
  | { kind: "noop" };

export function createPaletteEffects() {
  return {
    revealPalette(inst: number) {
      fireMessage({ type: "reveal-palette", inst });
    },
    hidePalette() {
      fireMessage({ type: "hide-palette" });
    },
    notifyChromeView(
      view: ViewId,
      params?: URLSearchParams | Record<string, unknown>,
      inst?: number | null,
      readyGen?: number | null,
    ) {
      fireMessage(chromeNavigationMessage(view, params, inst, readyGen));
    },
    navigateBack() {
      return sendMessage<{ view: ViewId; params?: Record<string, unknown> } | null>({ type: "navigate-back" });
    },
    getSelectedTabDomIds() {
      return sendMessage<string[]>({ type: "get-selected-tab-dom-ids" });
    },
    activateTab(domId: string) {
      fireMessage({ type: "activate-tab", domId });
    },
    activateCurrentViewRow(
      index: number,
      source: "selection" | "shortcut",
      switchToTarget = false,
      listVersion?: number,
      chordKey?: string | null,
      activation = "trace",
      expectedRowId?: string | null,
    ) {
      return sendMessage<ActivateViewRowResult>({
        type: "activate-current-view-row",
        index,
        source,
        ...(switchToTarget ? { switchToTarget: true } : {}),
        ...(typeof listVersion === "number" && listVersion > 0 ? { listVersion } : {}),
        ...(chordKey ? { chordKey, activation } : {}),
        ...(expectedRowId ? { expectedRowId } : {}),
      });
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
    setActiveWorkspaceIcon(kind: "emoji" | "zen" | "lucide", value: string) {
      return sendMessage<{ success: boolean; error?: string }>({ type: "set-active-workspace-icon", kind, value });
    },
    setActiveWorkspaceName(name: string) {
      return sendMessage<boolean>({ type: "set-active-workspace-name", name });
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
    closeTabsForDomain(domain: string, workspaceId = "all", includePinned = false) {
      return sendMessage<{ closed: number; skippedPinned: number; skippedEssential: number }>({
        type: "close-tabs-for-domain",
        domain,
        workspaceId,
        includePinned,
      });
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
    resizePanel(
      view: ViewId,
      height: number,
      dynamicSidebarWidth?: number,
      inst?: number | null,
      readyGen?: number | null,
    ) {
      return sendMessage({
        type: "resize-panel",
        view,
        height,
        dynamicSidebarWidth,
        ...(typeof inst === "number" ? { inst } : {}),
        ...(typeof readyGen === "number" ? { readyGen } : {}),
      });
    },
    popupReady<T>(message: unknown) {
      return sendMessage<T>(message);
    },
  };
}
