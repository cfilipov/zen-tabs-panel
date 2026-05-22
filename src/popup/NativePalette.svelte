<script lang="ts">
  import { onMount, tick } from "svelte";
  import PaletteShell from "./components/PaletteShell.svelte";
  import ViewHost from "./views/ViewHost.svelte";
  import {
    activationPlanForRenderedRow,
    activationPlanForSelection,
    activationPlanForShortcut,
    type ActivationPlan,
  } from "./interaction/activation-plan";
  import { nextActionsPage } from "./interaction/actions-navigation";
  import { createBridgeDispatchController } from "./interaction/bridge-dispatch";
  import {
    installChordBridgeHandlers,
    type BridgeKeyData,
    type BridgeReply,
    type ForceReadyPayload,
    type InvalidChordFeedback,
  } from "./chord-bridge";
  import { closeSelectionPlan } from "./interaction/close-plan";
  import {
    interpretStructuralInput,
    type InteractionCommand,
  } from "./interaction/interpreter";
  import { invalidChordMessage, isInvalidChordFeedbackInput } from "./interaction/invalid-chord";
  import { chordFromKey } from "./interaction/inputs";
  import { DUPLICATE_PROMPT_ACTIONS, type DuplicatePromptAction } from "./interaction/duplicate-prompt-options";
  import { createNativePaletteInteractionRuntime } from "./interaction/native-palette-runtime";
  import { previewPlan } from "./interaction/preview-plan";
  import { applyInteractionCommand } from "./interaction/runtime";
  import { tabSubtitleForView } from "./interaction/tab-display";
  import {
    loadWindowForIndex,
    rowInWindow,
    visibleRangeRequest,
  } from "./interaction/list-window";
  import { replayKeyForBadgeIndex, replayKeyForNavigationIndex, replayKeyForSelection as replayKeyForSelectionState } from "./interaction/replay-trace";
  import { stableRowIdForActivation } from "./interaction/row-identity";
  import {
    duplicatePromptPreviewDomId,
    nextSelectionIndex,
    type SelectionContext,
  } from "./interaction/selection";
  import { nextSectionJumpIndex } from "./interaction/section-jump";
  import {
    keepOnlyTabInfoDuplicate,
    removeRecentlyClosedRow,
    removeTabFromDuplicateGroups,
    removeTabFromRows,
    removeTabInfoDuplicate,
  } from "./interaction/row-state";
  import {
    normalizeWorkspaceFilter,
    toggleSortForView,
    toggleWorkspaceFilterValue,
    workspaceFilterByIndex,
    workspaceReloadKind,
  } from "./interaction/sort-filter";
  import { createTerminalCommandBlocker } from "./interaction/terminal-command-block";
  import {
    resolveDuplicatePromptActivation,
    type DuplicatePromptActivation,
    type DuplicatePromptActivationContext,
  } from "./interaction/duplicate-prompt-activation";
  import { buildSidebarModel, type SidebarHintId } from "./interaction/sidebar-model";
  import {
    canDrillSelectionInView,
    canRestoreInView,
    isWorkspaceFilterView,
  } from "./interaction/view-capabilities";
  import { createContainerClient } from "./runtime/container-client";
  import { createExtensionClient } from "./runtime/extension-client";
  import { createFolderClient } from "./runtime/folder-client";
  import { createHistoryClient, type RecentlyClosedRow } from "./runtime/history-client";
  import { createNativePaletteLoaders } from "./runtime/native-palette-loaders";
  import { createNativePalettePanelController, usesFitContentHeight } from "./runtime/native-palette-panel";
  import { createPaletteEffects } from "./runtime/palette-effects";
  import {
    directionalListItemId,
    scrollPaletteListIndexIntoView,
    scrollSelectedItemIntoView,
    snapshotKeyEvent,
  } from "./runtime/palette-dom";
  import { createPaletteRevealController } from "./runtime/palette-reveal";
  import { createProfileClient } from "./runtime/profile-client";
  import { createTabInfoClient } from "./runtime/tab-info-client";
  import { createViewLoadController } from "./runtime/view-load-controller";
  import {
    createTabIndexClient,
    type DomainIndexRow,
    type TabIndexRow,
  } from "./runtime/tab-index-client";
  import { createWorkspaceClient } from "./runtime/workspace-client";
  import type { NativeListRow } from "./view-loaders/list-loader";
  import {
    isNativeListView,
    isNativePrefixView,
    isNativeTabView,
    resolveViewTitle,
    resolveViewOpenPlan,
    type NativeListView,
  } from "./view-loaders/view-registry";
  import { isDomainRow, isTabRow } from "./view-loaders/list-row";
  import { formatDuration } from "./views/format";
  import {
    actionItemsForPage,
    applyActionSelection,
    type ActionMenuItem,
  } from "./views/actions-model";
  import type { ViewId } from "../shared/types";
  import { createNativePaletteState } from "./store/native-palette-state.svelte";

  type SidebarHint = {
    id: string;
    label: string;
    badge: string;
    hidden?: boolean;
    onclick: () => void;
  };

  const client = createTabIndexClient();
  const containerClient = createContainerClient();
  const extensionClient = createExtensionClient();
  const folderClient = createFolderClient();
  const historyClient = createHistoryClient();
  const profileClient = createProfileClient();
  const tabInfoClient = createTabInfoClient();
  const workspaceClient = createWorkspaceClient();
  const effects = createPaletteEffects();

  const paletteStore = createNativePaletteState();
  const palette = paletteStore.state;
  let pageAlive = true;
  let skipAnimations = $state(new URLSearchParams(location.search).get("skipAnimations") === "1");
  let suppressViewTransition = $state(true);
  let invalidChordHint = $state<string | null>(null);
  let invalidChordHintTimer: number | null = null;
  let paletteRevealed = false;
  const terminalCommandBlocker = createTerminalCommandBlocker();
  const revealController = createPaletteRevealController({
    sendReveal: (inst) => {
      paletteRevealed = true;
      effects.revealPalette(inst);
    },
  });
  const bridgeDispatch = createBridgeDispatchController({
    dispatchKey: handleKeyInput,
    armBridgeRevealTimer: () => effects.bridgeDispatchSettled(revealController.inst),
    armVisibleRevealTimer: revealController.arm,
    clearRevealTimer: revealController.clear,
  });

  function markTerminalCommandDispatched() {
    terminalCommandBlocker.markDispatched();
  }

  function clearTerminalCommandDispatched() {
    terminalCommandBlocker.clear();
  }

  function terminalCommandStillBlocking() {
    return terminalCommandBlocker.isBlocking();
  }

  function showInvalidChord(feedback: InvalidChordFeedback = {}) {
    invalidChordHint = invalidChordMessage(feedback.key);
    if (invalidChordHintTimer !== null) {
      window.clearTimeout(invalidChordHintTimer);
    }
    invalidChordHintTimer = window.setTimeout(() => {
      invalidChordHint = null;
      invalidChordHintTimer = null;
    }, 3000);
  }

  function clearInvalidChordHint() {
    invalidChordHint = null;
    if (invalidChordHintTimer !== null) {
      window.clearTimeout(invalidChordHintTimer);
      invalidChordHintTimer = null;
    }
  }

  const headerHint = $derived(invalidChordHint);
  const headerHintTone = $derived<"normal" | "error">(invalidChordHint ? "error" : "normal");
  const headerOverlay = $derived(palette.currentView === "actions" && !!headerHint);
  const headerHidden = $derived(palette.currentView === "actions" && !headerHint);
  const fitContentHeight = $derived(usesFitContentHeight(palette.currentView));
  const renderedActionSections = $derived(palette.actionSections);
  const pageCount = $derived(Math.max(1, Math.max(...renderedActionSections.map((section) => section.page))));
  const viewLoad = createViewLoadController<ViewId>({
    getCurrentView: () => palette.currentView,
    setCurrentView: paletteStore.setCurrentView,
    setLoading: paletteStore.setLoading,
    setError: paletteStore.setError,
  });
  const paletteLoaders = createNativePaletteLoaders({
    palette,
    paletteStore,
    viewLoad,
    tabIndexClient: client,
    workspaceClient,
    extensionClient,
    historyClient,
    containerClient,
    folderClient,
    profileClient,
    tabInfoClient,
    getSelectedTabDomIds: effects.getSelectedTabDomIds,
  });
  const panelController = createNativePalettePanelController({
    tick,
    getCurrentView: () => palette.currentView,
    isAlive: () => pageAlive,
    getElementById: (id) => document.getElementById(id),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    resizePanel: (view, height, width) => effects.resizePanel(view, height, width, revealController.inst).catch(() => {}),
  });
  const visibleActionItems = $derived(actionItemsForPage(renderedActionSections, palette.currentPage));
  const allActionItems = $derived(renderedActionSections.flatMap((section) => section.items));
  const prefixItems = $derived(isNativePrefixView(palette.currentView) ? palette.actionPrefixItemsByView[palette.currentView] ?? [] : []);
  const title = $derived(resolveViewTitle(palette.currentView, {
    currentDomain: palette.currentDomain,
    actionLabel: allActionItems.find((item) => item.view === palette.currentView)?.label ?? null,
  }));
  const selectedActionId = $derived(palette.currentView === "actions" ? visibleActionItems[palette.selectedIndex]?.id ?? null : null);
  const actionSectionsForRender = $derived(applyActionSelection(renderedActionSections, selectedActionId));
  const selectedPrefixId = $derived(isNativePrefixView(palette.currentView) ? prefixItems[palette.selectedIndex]?.id ?? null : null);
  const prefixItemsForRender = $derived(prefixItems.map((item) => ({
    ...item,
    selected: selectedPrefixId !== null && item.id === selectedPrefixId,
  })));
  const selectedRow = $derived(isNativeListView(palette.currentView) ? rowForIndex(palette.selectedIndex) : null);
  const selectedTabRow = $derived(isTabRow(selectedRow) ? selectedRow : null);
  const selectedDomainRow = $derived(isDomainRow(selectedRow) ? selectedRow : null);
  const tabRows = $derived(palette.rows.filter(isTabRow));
  const domainRows = $derived(palette.rows.filter(isDomainRow));
  const duplicateTabs = $derived(palette.duplicateGroups.flatMap((group) => group.tabs));
  const duplicatePromptTabs = $derived((palette.duplicatePromptGroup?.tabs ?? []).slice(0, 9));
  const selectedRowDomId = $derived(selectedTabRow?.domId ?? null);
  const selectedDuplicateTabRow = $derived(
    palette.currentView === "duplicates" ? duplicateTabs[palette.selectedIndex] ?? null : null,
  );
  const selectedDuplicatePromptTabRow = $derived(
    palette.currentView === "duplicate-prompt" && palette.selectedIndex >= DUPLICATE_PROMPT_ACTIONS.length
      ? duplicatePromptTabs[palette.selectedIndex - DUPLICATE_PROMPT_ACTIONS.length] ?? null
      : null,
  );
  const selectedDuplicatePromptDomId = $derived(duplicatePromptPreviewDomId(
    palette.currentView,
    palette.selectedIndex,
    palette.duplicatePromptDomId,
    duplicatePromptTabs.map((tab) => tab.domId),
    DUPLICATE_PROMPT_ACTIONS.length,
  ));
  const selectedDomain = $derived(selectedDomainRow?.domain ?? null);
  const navigationEntries = $derived(palette.navigationHistory?.entries ?? []);
  const activeWorkspaceId = $derived(palette.sidebarWorkspaces.find((workspace) => workspace.isActive)?.uuid ?? null);
  const sidebarModel = $derived(buildSidebarModel({
    view: palette.currentView,
    selectedIndex: palette.selectedIndex,
    closeSelectionAvailable: palette.currentView === "duplicate-prompt" ? !!selectedDuplicatePromptTabRow : undefined,
    domainsSortAlpha: palette.domainsSortAlpha,
    tabsByAgeNewestFirst: palette.tabsByAgeNewestFirst,
  }));
  const sidebarHintsOnly = $derived(sidebarModel.hintsOnly);
  const sidebarSortLabel = $derived(sidebarModel.sortLabel);
  const sidebarHints = $derived<SidebarHint[]>(sidebarModel.hints.map((hint) => ({
    ...hint,
    onclick: sidebarHintAction(hint.id),
  })));
  const sidebarHidden = $derived(sidebarModel.hidden);
  const dynamicSidebarWidth = $derived(!sidebarHidden && !isWorkspaceFilterView(palette.currentView));
  const interactionRuntime = createNativePaletteInteractionRuntime({
    runDuplicatePromptAction,
    getNavigationHistory: () => palette.navigationHistory,
    navigateToHistoryIndex,
    cancel: effects.hidePalette,
    back: goBack,
    moveSelection,
    moveSelectionDirectional,
    activateSelection: activateSelected,
    activateSelectionAndSwitch: activateSelectedAndSwitch,
    activateRow,
    activateRowAndSwitch,
    cyclePage,
    jumpSection,
    closeSelection: closeSelectedTabRow,
    closeAll: closeAllRowsInView,
    restoreSelectionKeepOpen: restoreSelectedRecentlyClosed,
    drillSelection: drillSelectedParent,
    toggleSort: toggleCurrentSort,
    toggleWorkspaceFilter,
    filterWorkspaceIndex: filterWorkspaceByIndex,
    switchWorkspaceIndex: switchWorkspaceByIndex,
    openExtensionIndex: openExtensionByIndex,
  });

  function sidebarHintAction(id: SidebarHintId) {
    if (id === "close") return closeSelectedTabRow;
    if (id === "close-all") return closeAllRowsInView;
    if (id === "restore") return restoreSelectedRecentlyClosed;
    return drillSelectedParent;
  }

  function isActionsView(view: ViewId) {
    return view === "actions";
  }

  function isCurrentActionsView() {
    return isActionsView(palette.currentView);
  }

  function shouldScrollListSelection() {
    return !isCurrentActionsView() && !isNativePrefixView(palette.currentView);
  }

  function viewParams(view: NativeListView) {
    return paletteLoaders.viewParams(view);
  }

  function notifyChromeView(view: ViewId, params?: URLSearchParams | Record<string, unknown>) {
    effects.notifyChromeView(view, params);
  }

  async function finishOpenView(view: ViewId) {
    await requestPanelResize(view);
    if (usesFitContentHeight(view)) {
      window.setTimeout(() => {
        if (pageAlive && palette.currentView === view) void requestPanelResize(view);
      }, 80);
      window.setTimeout(() => {
        if (pageAlive && palette.currentView === view) void requestPanelResize(view);
      }, 220);
    }
    return true;
  }

  async function openNativeView(view: ViewId, params?: URLSearchParams | Record<string, unknown>, notifyChrome = false) {
    clearTerminalCommandDispatched();
    if (notifyChrome) notifyChromeView(view, params);
    const plan = resolveViewOpenPlan(view, params);

    if (plan.kind === "actions") {
      resetToActions();
      await paletteLoaders.loadActionsData();
    } else if (plan.kind === "list") {
      paletteStore.enterDomainList(plan.domain);
      await paletteLoaders.loadListView(plan.view, 0, 80, true, { ...plan.params, ...viewParams(plan.view) });
    } else if (plan.kind === "prefix") {
      paletteStore.enterPrefixView(plan.view);
      await paletteLoaders.loadActionsData();
    } else if (plan.kind === "loader") {
      await paletteLoaders.loadRegisteredView(plan.loader, params);
    } else {
      return false;
    }

    return finishOpenView(view);
  }

  async function activateAction(item: ActionMenuItem) {
    await activateVisibleActionItem(item, "mouse");
  }

  async function activateTab(row: { domId: string }) {
    markTerminalCommandDispatched();
    revealController.clear();
    effects.activateTab(row.domId);
  }

  function replayKeyForSelection(shifted = false) {
    return replayKeyForSelectionState({
      view: palette.currentView,
      selectedIndex: palette.selectedIndex,
      navigationHistory: palette.navigationHistory,
      shifted,
    });
  }

  function stableRowIdentityContext() {
    return {
      view: palette.currentView,
      offset: palette.offset,
      navigationHistory: palette.navigationHistory,
      recentlyClosedRows: palette.recentlyClosedRows,
      duplicateTabs,
      rows: palette.rows,
      workspaceRows: palette.workspaceRows,
      containerRows: palette.containerRows,
      folderRows: palette.folderRows,
      profileRows: palette.profileRows,
    };
  }

  async function activateDomain(row: DomainIndexRow) {
    paletteStore.setCurrentDomain(row.domain);
    await openNativeView("domain-tabs", { domain: row.domain }, true);
  }

  function restoreClosedTab(row: RecentlyClosedRow, keepOpen = false) {
    if (!keepOpen) markTerminalCommandDispatched();
    if (!keepOpen) revealController.clear();
    effects.restoreClosedTab(row.sessionId, keepOpen);
  }

  async function navigateToHistoryIndex(index: number) {
    markTerminalCommandDispatched();
    revealController.clear();
    effects.navigateToHistoryIndex(index);
  }

  async function activateCurrentChromeModelRow(
    index: number,
    source: "selection" | "shortcut",
    switchToTarget = false,
    chordKey: string | null = null,
    expectedRowId: string | null = null,
  ) {
    const chromeIndex = source === "shortcut" && isNativeListView(palette.currentView)
      ? palette.offset + index
      : index;
    const stableRowId = expectedRowId ?? stableRowIdForActivation(stableRowIdentityContext(), index, source);
    const result = await effects.activateCurrentViewRow(
      chromeIndex,
      source,
      switchToTarget,
      palette.listVersion,
      chordKey,
      "trace",
      stableRowId,
    );
    if (result?.kind === "open-view") {
      await openNativeView(result.view, result.params || {}, true);
      return;
    }
    if (result?.kind === "terminal") {
      markTerminalCommandDispatched();
      revealController.clear();
    }
  }

  async function activateVisibleActionItem(
    item: ActionMenuItem,
    source: "selection" | "shortcut" | "mouse" = "selection",
  ) {
    if (item.disabled) return;
    const items = palette.currentView === "actions"
      ? allActionItems
      : isNativePrefixView(palette.currentView)
      ? prefixItems
      : [];
    const index = Math.max(0, items.findIndex((candidate) => candidate.id === item.id));
    const result = await effects.activateCurrentViewRow(
      index,
      source === "shortcut" ? "shortcut" : "selection",
      false,
      palette.listVersion,
      item.hotkey || null,
      source,
      item.id,
    );
    if (result?.kind === "open-view") {
      await openNativeView(result.view, result.params || {}, true);
      return;
    }
    if (result?.kind === "terminal") {
      markTerminalCommandDispatched();
      revealController.clear();
    }
  }

  async function switchWorkspaceByIndex(index: number) {
    markTerminalCommandDispatched();
    revealController.clear();
    await effects.switchWorkspaceByIndex(index);
  }

  async function openExtensionByIndex(index: number) {
    markTerminalCommandDispatched();
    revealController.clear();
    await effects.openExtensionPopupByIndex(index);
  }

  async function setActiveWorkspaceIcon(kind: "emoji" | "zen" | "lucide", value: string) {
    markTerminalCommandDispatched();
    revealController.clear();
    const result = await effects.setActiveWorkspaceIcon(kind, value);
    if (result?.success) {
      effects.hidePalette();
    } else {
      paletteStore.setError(result?.error || "Could not set workspace icon");
    }
  }

  async function setActiveWorkspaceName(name: string) {
    markTerminalCommandDispatched();
    revealController.clear();
    const result = await effects.setActiveWorkspaceName(name);
    if (result) {
      effects.hidePalette();
    } else {
      clearTerminalCommandDispatched();
      paletteStore.setError("Could not rename workspace");
    }
  }

  function closeDuplicateTab(row: TabIndexRow) {
    effects.closeTab(row.domId);
    const groups = removeTabFromDuplicateGroups(palette.duplicateGroups, row.domId);
    paletteStore.replaceDuplicateGroups(groups);
    if (palette.currentView === "duplicates") {
      const count = groups.reduce((sum, group) => sum + group.tabs.length, 0);
      paletteStore.selectIndex(count <= 0 ? -1 : Math.min(palette.selectedIndex, count - 1));
    }
  }

  function closeDuplicatePromptTab(row: TabIndexRow) {
    effects.closeTab(row.domId);
    if (!palette.duplicatePromptGroup) return;
    const tabs = palette.duplicatePromptGroup.tabs.filter((tab) => tab.domId !== row.domId);
    paletteStore.replaceDuplicatePromptGroup(tabs.length ? { ...palette.duplicatePromptGroup, tabs } : null);
    const nextIndex = tabs.length
      ? Math.min(palette.selectedIndex, DUPLICATE_PROMPT_ACTIONS.length + tabs.length - 1)
      : -1;
    paletteStore.selectIndex(nextIndex);
  }

  function closeSelectedTabRow() {
    const plan = closeSelectionPlan({
      view: palette.currentView,
      hasSelectedDuplicateTab: !!selectedDuplicateTabRow,
      hasSelectedDuplicatePromptTab: !!selectedDuplicatePromptTabRow,
      hasSelectedTabRow: !!selectedTabRow,
    });
    if (plan.kind === "duplicate-tab" && selectedDuplicateTabRow) {
      closeDuplicateTab(selectedDuplicateTabRow);
      return;
    }
    if (plan.kind === "duplicate-prompt-tab" && selectedDuplicatePromptTabRow) {
      closeDuplicatePromptTab(selectedDuplicatePromptTabRow);
      return;
    }
    if (plan.kind !== "native-tab-row") return;
    const row = selectedTabRow;
    if (!row) return;
    effects.closeTab(row.domId);
    const result = removeTabFromRows({ rows: palette.rows, total: palette.total, selectedIndex: palette.selectedIndex, domId: row.domId });
    paletteStore.replaceListWindow(result.rows, result.total, result.selectedIndex);
  }

  function closeTabRow(row: TabIndexRow) {
    effects.closeTab(row.domId);
    const result = removeTabFromRows({
      rows: palette.rows,
      total: palette.total,
      selectedIndex: palette.selectedIndex,
      domId: row.domId,
    });
    paletteStore.replaceListWindow(result.rows, result.total, result.selectedIndex);
  }

  async function closeAllRowsInView() {
    if (!isNativeTabView(palette.currentView)) return;
    const domIds = palette.rows.filter(isTabRow).map((row) => row.domId);
    if (!domIds.length) return;
    await Promise.all(domIds.map((domId) => effects.closeTabAndWait(domId).catch(() => {})));
    paletteLoaders.loadListView(palette.currentView, 0, 80, true, viewParams(palette.currentView));
  }

  function restoreSelectedRecentlyClosed() {
    if (!canRestoreInView(palette.currentView)) return;
    const row = palette.recentlyClosedRows[palette.selectedIndex];
    if (!row) return;
    restoreClosedTab(row, true);
    const result = removeRecentlyClosedRow({ rows: palette.recentlyClosedRows, selectedIndex: palette.selectedIndex, sessionId: row.sessionId });
    paletteStore.commitRecentlyClosed(result);
  }

  async function drillParentRow(row: TabIndexRow) {
    if (!canDrillSelectionInView(palette.currentView)) return;
    await openNativeView("child-tabs", { ...viewParams("child-tabs"), parentDomId: row.domId }, true);
  }

  async function drillSelectedParent() {
    if (!canDrillSelectionInView(palette.currentView) || !selectedTabRow) return;
    await drillParentRow(selectedTabRow);
  }

  async function toggleCurrentSort() {
    const result = toggleSortForView(palette.currentView, { domainsSortAlpha: palette.domainsSortAlpha, tabsByAgeNewestFirst: palette.tabsByAgeNewestFirst });
    paletteStore.setSortState(result);
    if (result.reloadView) await paletteLoaders.loadListView(result.reloadView, 0, 80, true, viewParams(result.reloadView));
  }

  async function reloadWorkspaceFilteredView() {
    const reloadKind = workspaceReloadKind(palette.currentView);
    if (reloadKind === "list" && isNativeListView(palette.currentView)) {
      await paletteLoaders.loadListView(palette.currentView);
      return;
    }
    if (reloadKind === "duplicates") {
      await paletteLoaders.loadDuplicates();
    }
  }

  async function setWorkspaceFilter(nextFilter: string) {
    paletteStore.setWorkspaceFilter(normalizeWorkspaceFilter(nextFilter));
    await reloadWorkspaceFilteredView();
  }

  async function toggleWorkspaceFilter() {
    await setWorkspaceFilter(toggleWorkspaceFilterValue(palette.workspaceFilter, activeWorkspaceId));
  }

  async function filterWorkspaceByIndex(index: number) {
    const nextFilter = workspaceFilterByIndex(palette.workspaceFilter, palette.sidebarWorkspaces, index);
    if (nextFilter) await setWorkspaceFilter(nextFilter);
  }

  function closeTabInfoDuplicate(row: TabIndexRow) {
    effects.closeTab(row.domId);
    paletteStore.replaceTabInfoDuplicates(removeTabInfoDuplicate(palette.tabInfoDuplicates, row.domId));
  }

  function closeOtherTabInfoDuplicates() {
    if (!palette.tabInfo) return;
    const selfDomId = palette.tabInfo.domId;
    for (const duplicate of palette.tabInfoDuplicates) {
      if (duplicate.domId !== selfDomId) {
        effects.closeTab(duplicate.domId);
      }
    }
    paletteStore.replaceTabInfoDuplicates(keepOnlyTabInfoDuplicate(palette.tabInfoDuplicates, selfDomId));
  }

  function runDuplicatePromptAction(action: DuplicatePromptAction) {
    markTerminalCommandDispatched();
    revealController.clear();
    effects.runDuplicatePromptAction(action);
  }

  async function activateDuplicatePromptTab(row: TabIndexRow, index: number) {
    if (row.active) return;
    const key = replayKeyForBadgeIndex(index);
    await activateCurrentChromeModelRow(index, "shortcut", false, key, row.domId);
  }

  async function activateTabInfoDuplicate(row: TabIndexRow, index: number) {
    if (row.active) return;
    await activateCurrentChromeModelRow(index, "selection", false, replayKeyForBadgeIndex(index), row.domId);
  }


  function previewTab(row: TabIndexRow) {
    effects.previewTab(row.domId);
  }

  function previewTabLike(row: { domId: string }) {
    effects.previewTab(row.domId);
  }

  function clearPreview() {
    effects.clearPreview();
  }

  function resetToActions() {
    clearPreview();
    paletteStore.enterActionsView();
  }

  async function goBack() {
    if (palette.currentView === "duplicate-prompt") {
      effects.hidePalette();
      return;
    }
    const previous = await effects.navigateBack().catch(() => null);
    if (previous?.view && previous.view !== "actions") {
      clearPreview();
      await openNativeView(previous.view, previous.params || {});
      return;
    }
    resetToActions();
    await paletteLoaders.loadActionsData();
    await requestPanelResize("actions");
  }

  function moveSelection(delta: 1 | -1) {
    paletteStore.selectIndex(nextSelectionIndex(selectionContext(), delta));
    if (shouldScrollListSelection()) {
      ensureListIndexLoaded(palette.selectedIndex);
    }
    scrollCurrentSelectionIntoView();
  }

  function moveSelectionDirectional(delta: 1 | -1) {
    const targetId = directionalListItemId(delta, {
      currentPage: palette.currentView === "actions" ? palette.currentPage : undefined,
    });
    if (!targetId) return;

    const items = palette.currentView === "actions"
      ? visibleActionItems
      : isNativePrefixView(palette.currentView)
      ? prefixItems
      : [];
    const index = items.findIndex((item) => item.id === targetId);
    if (index < 0) return;

    paletteStore.selectIndex(index);
    scrollCurrentSelectionIntoView();
  }

  function selectionContext(): SelectionContext {
    return {
      view: palette.currentView,
      selectedIndex: palette.selectedIndex,
      actionCount: visibleActionItems.length,
      prefixCount: prefixItems.length,
      navigationCount: navigationEntries.length,
      recentlyClosedCount: palette.recentlyClosedRows.length,
      workspaceCount: palette.workspaceRows.length,
      containerCount: palette.containerRows.length,
      folderCount: palette.folderRows.length,
      profileRows: palette.profileRows,
      duplicateTabCount: duplicateTabs.length,
      duplicatePromptCount: DUPLICATE_PROMPT_ACTIONS.length + duplicatePromptTabs.length,
      duplicatePromptActionCount: DUPLICATE_PROMPT_ACTIONS.length,
      rowCount: isNativeListView(palette.currentView) ? palette.total : palette.rows.length,
      isPrefixView: isNativePrefixView(palette.currentView),
    };
  }

  function cyclePage(delta: 1 | -1) {
    setActionsPage(palette.currentPage + delta);
  }

  function setActionsPage(targetPage: number) {
    if (!isCurrentActionsView() || pageCount <= 1) return;
    const nextPage = nextActionsPage(palette.currentPage, targetPage, pageCount);
    if (nextPage === null) return;
    paletteStore.selectActionsPage(nextPage);
    clearPreview();
  }

  function jumpSection(delta: 1 | -1) {
    const nextIndex = nextSectionJumpIndex({
      view: palette.currentView,
      selection: selectionContext(),
      actionSections: renderedActionSections,
      currentPage: palette.currentPage,
      visibleItemCount: visibleActionItems.length,
    }, delta);
    if (nextIndex !== null) {
      paletteStore.selectIndex(nextIndex);
      scrollCurrentSelectionIntoView();
    }
  }

  async function applyActivationPlan(plan: ActivationPlan) {
    if (plan.kind === "action-selection") {
      const item = visibleActionItems[plan.index];
      if (item) await activateVisibleActionItem(item, "selection");
    } else if (plan.kind === "prefix-selection") {
      const item = prefixItems[plan.index];
      if (item) await activateVisibleActionItem(item, "selection");
    } else if (plan.kind === "chrome-model-row") {
      const chordKey = plan.source === "selection"
        ? replayKeyForSelection(plan.switchToTarget)
        : replayKeyForBadgeIndex(plan.index, plan.switchToTarget);
      await activateCurrentChromeModelRow(plan.index, plan.source, plan.switchToTarget, chordKey);
    } else if (plan.kind === "duplicate-prompt") {
      await applyDuplicatePromptActivation(
        resolveDuplicatePromptActivation(duplicatePromptActivationContext(), plan.index, plan.source),
        plan.source,
      );
    }
  }

  async function activateSelected(switchToTarget = false) {
    await applyActivationPlan(activationPlanForSelection(
      palette.currentView,
      palette.selectedIndex,
      switchToTarget,
    ));
  }

  async function activateSelectedAndSwitch() {
    await activateSelected(true);
  }

  async function activateRow(index: number, switchToTarget = false) {
    await applyActivationPlan(activationPlanForShortcut(palette.currentView, index, switchToTarget));
  }

  async function activateRenderedRow(index: number, switchToTarget = false) {
    const plan = activationPlanForRenderedRow(palette.currentView, index, switchToTarget);
    if (plan.kind === "chrome-model-row") {
      const chordKey = palette.currentView === "navigation"
        ? replayKeyForNavigationIndex(palette.navigationHistory, index)
        : replayKeyForBadgeIndex(index, switchToTarget);
      await activateCurrentChromeModelRow(index, "selection", switchToTarget, chordKey);
      return;
    }
    await applyActivationPlan(plan);
  }

  async function activateRowAndSwitch(index: number) {
    await activateRow(index, true);
  }

  function duplicatePromptActivationContext(): DuplicatePromptActivationContext {
    return {
      selectedIndex: palette.selectedIndex,
      duplicatePromptTabs,
    };
  }

  async function applyDuplicatePromptActivation(
    activation: DuplicatePromptActivation,
    source: "selection" | "shortcut",
  ) {
    if (activation.kind === "duplicate-prompt-action") {
      runDuplicatePromptAction(activation.action);
      return;
    }
    if (activation.kind === "activate-tab") {
      if (activation.row.active) return;
      await activateCurrentChromeModelRow(
        activation.rowIndex,
        source,
        false,
        replayKeyForBadgeIndex(activation.rowIndex),
        activation.row.domId,
      );
    }
  }

  function rowForIndex(index: number) {
    return rowInWindow(palette.rows, palette.offset, index);
  }

  function ensureListIndexLoaded(index: number) {
    if (!isNativeListView(palette.currentView)) return;
    const request = loadWindowForIndex({ index, offset: palette.offset, rowCount: palette.rows.length });
    if (request) {
      void paletteLoaders.loadListView(palette.currentView, request.offset, request.limit, false)
        .then(scrollCurrentSelectionIntoView);
    }
  }

  function scrollListIndexIntoView(index: number) {
    scrollPaletteListIndexIntoView(index);
  }

  function scrollCurrentSelectionIntoView() {
    void tick().then(() => {
      if (!pageAlive) return;
      const scroll = () => {
        if (!pageAlive) return;
        if (shouldScrollListSelection()) {
          scrollListIndexIntoView(palette.selectedIndex);
        }
        scrollSelectedItemIntoView();
      };
      scroll();
      requestAnimationFrame(() => {
        scroll();
        setTimeout(scroll, 50);
      });
    });
  }

  function loadVisibleRange(nextOffset: number, limit: number) {
    if (!isNativeListView(palette.currentView)) return;
    const request = visibleRangeRequest(nextOffset, limit);
    paletteLoaders.loadListView(palette.currentView, request.offset, request.limit, false, viewParams(palette.currentView));
  }

  function tabSubtitle(row: TabIndexRow) {
    return tabSubtitleForView(palette.currentView, row, {
      now: Date.now(),
      formatDuration,
    });
  }

  async function runCommand(command: InteractionCommand) {
    await applyInteractionCommand(command, interactionRuntime);
  }

  async function handleKeyInput(input: BridgeKeyData) {
    if (terminalCommandStillBlocking()) {
      return false;
    }
    const keyInput = { kind: "key" as const, ...input };
    const chordKey = chordFromKey(keyInput);
    const visibleCommandItems = palette.currentView === "actions"
      ? allActionItems
      : isNativePrefixView(palette.currentView)
      ? prefixItems
      : [];
    const item = visibleCommandItems.find((candidate) => !!chordKey && candidate.hotkey === chordKey);
    if (item) {
      clearInvalidChordHint();
      await activateVisibleActionItem(item, "shortcut");
      return true;
    }

    const command = interpretStructuralInput(keyInput, {
      view: palette.currentView,
      selectedIndex: palette.selectedIndex,
      duplicatePromptActionCount: DUPLICATE_PROMPT_ACTIONS.length,
    });
    if (command.kind === "none") {
      if (isInvalidChordFeedbackInput(input)) {
        showInvalidChord({ key: chordKey ?? input.key });
      }
      return false;
    }

    clearInvalidChordHint();
    await runCommand(command);
    return true;
  }

  function handleBridgeKey(input: BridgeKeyData) {
    bridgeDispatch.queueOrHold(input);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!paletteRevealed) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const input = snapshotKeyEvent(event);
    const result = bridgeDispatch.visibleKeydownInput(input);
    if (result.preventDefault) event.preventDefault();
    if (result.stopPropagation) event.stopPropagation();
  }

  const requestPanelResize = panelController.requestPanelResize;
  const handlePaletteHeightChange = panelController.handlePaletteHeightChange;

  async function signalPopupReady() {
    if (!pageAlive) return null;
    try {
      return await effects.popupReady<BridgeReply>(revealController.popupReadyMessage());
    } catch {
      return null;
    }
  }

  async function drainBridge(reply: BridgeReply | null, generation?: number) {
    if (reply?.stale) return;
    if (reply?.view && reply.view !== palette.currentView) {
      await openNativeView(reply.view as ViewId);
      await requestPanelResize(reply.view as ViewId);
    }

    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    await bridgeDispatch.drainReply(reply, generation);
    if (reply?.visible) paletteRevealed = true;
    if (reply?.invalidChord) showInvalidChord(reply.invalidChord);
  }

  async function initializeBridge(initialViewReady: Promise<unknown>) {
    revealController.configureFromSearch(location.search);

    await initialViewReady.catch(() => {});
    await requestPanelResize(palette.currentView);
    const reply = await signalPopupReady();
    await drainBridge(reply);
    await tick();
    suppressViewTransition = false;
  }

  async function handleWarmRearm(data: { inst?: number; readyGen?: number; view?: ViewId; params?: Record<string, unknown>; skipAnimations?: boolean }) {
    const generation = bridgeDispatch.resetForWarmRearm();
    revealController.updateInst(data.inst);
    revealController.updateReadyGen(data.readyGen);
    skipAnimations = !!data.skipAnimations;
    suppressViewTransition = true;
    paletteRevealed = false;
    clearInvalidChordHint();
    clearPreview();

    const view = data.view || "actions";
    await openNativeView(view, data.params || {});
    if (!bridgeDispatch.isCurrentWarmGeneration(generation)) return;
    await requestPanelResize(view);
    if (!bridgeDispatch.isCurrentWarmGeneration(generation)) return;
    const reply = await signalPopupReady();
    await drainBridge(reply, generation);
    await tick();
    if (bridgeDispatch.isCurrentWarmGeneration(generation)) suppressViewTransition = false;
  }

  function handleForceReady(data: ForceReadyPayload) {
    clearTerminalCommandDispatched();
    bridgeDispatch.forceReady(data);
    if (data.visible) paletteRevealed = true;
    if (data.invalidChord) showInvalidChord(data.invalidChord);
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const initialView = params.get("view") as ViewId | null;
    const initialViewReady = initialView ? openNativeView(initialView, params) : paletteLoaders.loadActionsData();

    window.addEventListener("keydown", handleKeydown);
    pageAlive = true;
    revealController.markAlive();
    window.addEventListener("pagehide", handlePageHide);
    const uninstallBridge = installChordBridgeHandlers({
      onDeliverKey: handleBridgeKey,
      onWarmRearm: (data) => void handleWarmRearm(data),
      onForceReady: handleForceReady,
      onInvalidChord: showInvalidChord,
      onPaletteRevealed: () => { paletteRevealed = true; },
      onCancelReveal: () => {
        paletteRevealed = false;
        revealController.clear();
      },
      onGoToActions: goToActions,
    });
    void initializeBridge(initialViewReady);
    return () => {
      revealController.clear();
      panelController.invalidate();
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("pagehide", handlePageHide);
      clearInvalidChordHint();
      uninstallBridge();
    };
  });

  function handlePageHide() {
    pageAlive = false;
    paletteRevealed = false;
    revealController.markDead();
  }

  function goToActions() {
    if (!isCurrentActionsView()) {
      void openNativeView("actions").then(() => requestPanelResize("actions"));
    }
  }

  $effect(() => {
    const plan = previewPlan({
      view: palette.currentView,
      selectedTabDomId: selectedTabRow?.domId,
      selectedDuplicateTabDomId: selectedDuplicateTabRow?.domId,
      selectedDuplicatePromptDomId,
    });
    if (plan.kind === "preview") {
      previewTabLike({ domId: plan.domId });
    } else if (plan.kind === "clear") {
      clearPreview();
    }
  });
</script>

<PaletteShell
  {headerHidden}
  {title}
  hint={headerHint}
  hintTone={headerHintTone}
  {headerOverlay}
  onback={palette.currentView === "actions" ? undefined : goBack}
  {sidebarHidden}
  {sidebarHints}
  {sidebarHintsOnly}
  {sidebarSortLabel}
  sidebarWorkspaces={palette.sidebarWorkspaces}
  workspaceFilter={palette.workspaceFilter}
  {activeWorkspaceId}
  pageIndicatorHidden={!isCurrentActionsView() || pageCount <= 1}
  {pageCount}
  currentPage={palette.currentPage}
  {fitContentHeight}
  {dynamicSidebarWidth}
  onSidebarSort={toggleCurrentSort}
  onWorkspaceFilter={setWorkspaceFilter}
  onPage={setActionsPage}
  onheightchange={handlePaletteHeightChange}
>
  <ViewHost
    {palette}
    skipAnimations={skipAnimations || suppressViewTransition}
    loading={palette.loading}
    error={palette.error}
    actionSections={actionSectionsForRender}
    prefixItems={prefixItemsForRender}
    {tabRows}
    {domainRows}
    tabInfo={palette.tabInfo}
    tabInfoVisits={palette.tabInfoVisits}
    tabInfoDuplicates={palette.tabInfoDuplicates}
    tabInfoWorkspaces={palette.tabInfoWorkspaces}
    {selectedRowDomId}
    {selectedDomain}
    {activeWorkspaceId}
    {activateAction}
    openExtensionPopup={openExtensionByIndex}
    {previewTabLike}
    {clearPreview}
    {activateRenderedRow}
    restoreClosedTabKeepOpen={(row) => restoreClosedTab(row, true)}
    {activateTab}
    {activateDuplicatePromptTab}
    {activateTabInfoDuplicate}
    {closeDuplicateTab}
    {closeDuplicatePromptTab}
    {closeTabRow}
    {previewTab}
    {closeTabInfoDuplicate}
    {closeOtherTabInfoDuplicates}
    {runDuplicatePromptAction}
    {setActiveWorkspaceIcon}
    {setActiveWorkspaceName}
    {drillParentRow}
    {loadVisibleRange}
    {tabSubtitle}
    {setActionsPage}
  />
</PaletteShell>
