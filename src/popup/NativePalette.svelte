<script lang="ts">
  import { onMount, tick } from "svelte";
  import PaletteShell from "./components/PaletteShell.svelte";
  import ViewHost from "./views/ViewHost.svelte";
  import { resolveActionItemActivation, type ActionItemActivation } from "./interaction/action-activation";
  import { nextActionSectionIndex, nextActionsPage } from "./interaction/actions-navigation";
  import { createBridgeDispatchController } from "./interaction/bridge-dispatch";
  import {
    installChordBridgeHandlers,
    type BridgeKeyData,
    type BridgeReply,
    type ForceReadyPayload,
  } from "./chord-bridge";
  import {
    interpretVisibleInput,
    type InteractionCommand,
  } from "./interaction/interpreter";
  import { chordFromKey } from "./interaction/inputs";
  import { DUPLICATE_PROMPT_ACTIONS, type DuplicatePromptAction } from "./interaction/duplicate-prompt-options";
  import { createNativePaletteInteractionRuntime } from "./interaction/native-palette-runtime";
  import { applyInteractionCommand } from "./interaction/runtime";
  import {
    loadWindowForIndex,
    rowInWindow,
    visibleRangeRequest,
  } from "./interaction/list-window";
  import { replayKeyForBadgeIndex, replayKeyForNavigationIndex } from "./interaction/replay-trace";
  import {
    duplicatePromptPreviewDomId,
    nextDuplicatePromptSectionIndex,
    nextSelectionIndex,
    type SelectionContext,
  } from "./interaction/selection";
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
  import {
    resolveSelectionActivation,
    resolveViewActivation,
    type ViewActivation,
    type ViewActivationContext,
  } from "./interaction/view-activation";
  import { commandForViewActivation, type ViewCommand } from "./interaction/view-command";
  import { buildSidebarModel, type SidebarHintId } from "./interaction/sidebar-model";
  import {
    canDrillSelectionInView,
    canRestoreInView,
    isWorkspaceFilterView,
  } from "./interaction/view-capabilities";
  import { createContainerClient } from "./runtime/container-client";
  import { createExtensionClient, type ExtensionRow } from "./runtime/extension-client";
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
  import { formatDuration } from "./views/format";
  import {
    actionItemsForPage,
    actionNodesForSections,
    appendWorkspaceSwitchItems,
    applyActionMetadata,
    applyActionSelection,
    buildActionsMenuModel,
    prefixChildNodesForView,
    prefixItemsForView,
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
  const actionSections = buildActionsMenuModel();
  const CHROME_RESOLVED_ROW_VIEWS = new Set<ViewId>([
    "navigation",
    "child-tabs",
    "sibling-tabs",
    "parent-tabs",
    "last-visited",
    "unvisited-tabs",
    "domain-tabs",
    "tabs-by-age",
    "most-visited",
    "move-to-workspace",
    "open-in-container",
    "move-to-folder",
    "profiles",
  ]);

  const paletteStore = createNativePaletteState();
  const palette = paletteStore.state;
  let pageAlive = true;
  let skipAnimations = $state(new URLSearchParams(location.search).get("skipAnimations") === "1");
  let suppressViewTransition = $state(true);
  let terminalCommandDispatched = false;
  let terminalCommandDispatchedAt = 0;
  const revealController = createPaletteRevealController({
    sendReveal: effects.revealPalette,
  });
  const bridgeDispatch = createBridgeDispatchController({
    dispatchKey: handleKeyInput,
    armBridgeRevealTimer: () => effects.bridgeDispatchSettled(revealController.inst),
    armVisibleRevealTimer: revealController.arm,
    clearRevealTimer: revealController.clear,
  });

  function markTerminalCommandDispatched() {
    terminalCommandDispatched = true;
    terminalCommandDispatchedAt = Date.now();
  }

  function clearTerminalCommandDispatched() {
    terminalCommandDispatched = false;
    terminalCommandDispatchedAt = 0;
  }

  function terminalCommandStillBlocking() {
    if (!terminalCommandDispatched) return false;
    if (Date.now() - terminalCommandDispatchedAt < 500) return true;
    clearTerminalCommandDispatched();
    return false;
  }

  const headerHidden = $derived(palette.currentView === "actions");
  const fitContentHeight = $derived(usesFitContentHeight(palette.currentView));
  const pageCount = $derived(Math.max(1, Math.max(...actionSections.map((section) => section.page))));
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
  const renderedActionSections = $derived(
    applyActionMetadata(
      appendWorkspaceSwitchItems(actionSections, palette.actionsWorkspaces, palette.actionWorkspaceTabCounts),
      palette.actionCounts,
      palette.disabledActionIds,
      palette.actionIconHtmlById,
      palette.actionPreviewsById,
    ),
  );
  const visibleActionItems = $derived(actionItemsForPage(renderedActionSections, palette.currentPage));
  const allActionItems = $derived(renderedActionSections.flatMap((section) => section.items));
  const allActionNodes = $derived(actionNodesForSections(renderedActionSections));
  const prefixItems = $derived(isNativePrefixView(palette.currentView) ? prefixItemsForView(palette.currentView) : []);
  const prefixNodes = $derived(isNativePrefixView(palette.currentView) ? prefixChildNodesForView(palette.currentView) : []);
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
    fireActionEffect: (actionId) => performActionItemActivation({ kind: "fire-action", actionId }),
    activateVisibleAction: async (actionId) => {
      const item = [...allActionItems, ...prefixItems].find((candidate) => candidate.id === actionId);
      if (item) await performActionItem(item);
    },
    openView: (view) => openNativeView(view, undefined, true),
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

  function isDomainRow(row: NativeListRow | null): row is DomainIndexRow {
    return row?.kind === "domain";
  }

  function isTabRow(row: NativeListRow | null): row is TabIndexRow {
    return !!row && row.kind !== "domain";
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
    } else if (plan.kind === "loader") {
      await paletteLoaders.loadRegisteredView(plan.loader, params);
    } else {
      return false;
    }

    return finishOpenView(view);
  }

  async function performActionItemActivation(activation: ActionItemActivation) {
    if (activation.kind === "fire-action") {
      markTerminalCommandDispatched();
      revealController.clear();
      effects.runAction(activation.actionId);
      return;
    }
    if (activation.kind === "switch-workspace") {
      markTerminalCommandDispatched();
      switchWorkspace(activation.workspaceId);
      return;
    }
    if (activation.kind === "open-view") {
      await openNativeView(activation.view, undefined, true);
      return;
    }
  }

  async function performActionItem(item: ActionMenuItem) {
    await performActionItemActivation(resolveActionItemActivation(item));
  }

  async function activateAction(item: ActionMenuItem) {
    const activation = resolveActionItemActivation(item);
    if (activation.kind === "none") return;
    if (activation.kind === "switch-workspace") {
      switchWorkspace(activation.workspaceId);
      return;
    }

    const actionNodes = isNativePrefixView(palette.currentView) ? prefixNodes : allActionNodes;
    const command = interpretVisibleInput(
      { kind: "mouse", targetId: item.id },
      { view: palette.currentView },
      actionNodes,
    );
    if (command.kind !== "none") {
      await runCommand(command);
    }
  }

  function activateTab(row: { domId: string }) {
    markTerminalCommandDispatched();
    revealController.clear();
    effects.activateTab(row.domId);
  }

  function recordSyntheticChordKey(key: string | null | undefined) {
    if (!key) return;
    try {
      effects.synthChordKey(key, palette.currentView, "trace");
    } catch {
      // Replay tracing is best-effort; it must never block the command.
    }
  }

  function traceReplayInput(input: BridgeKeyData) {
    recordSyntheticChordKey(chordFromKey({ kind: "key", ...input }));
  }

  function traceReplayForListIndex(index: number, shifted = false) {
    recordSyntheticChordKey(replayKeyForBadgeIndex(index, shifted));
  }

  function traceReplayForSelection(shifted = false) {
    if (palette.currentView === "actions" || isNativePrefixView(palette.currentView)) return;
    if (palette.currentView === "navigation") {
      recordSyntheticChordKey(replayKeyForNavigationIndex(palette.navigationHistory, palette.selectedIndex));
      return;
    }
    traceReplayForListIndex(palette.selectedIndex, shifted);
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
    await applyViewActivation({ kind: "navigate-history-index", index });
  }

  function activateChromeResolvedRow(index: number, source: "selection" | "shortcut", switchToTarget = false) {
    markTerminalCommandDispatched();
    revealController.clear();
    effects.activateViewRow(palette.currentView, index, source, switchToTarget, palette.listVersion);
  }

  function switchWorkspace(workspaceId: string) {
    markTerminalCommandDispatched();
    revealController.clear();
    effects.switchWorkspace(workspaceId);
  }

  function openExtensionPopup(extension: ExtensionRow) {
    markTerminalCommandDispatched();
    revealController.clear();
    effects.openExtensionPopup(extension.id);
  }

  function switchWorkspaceByIndex(index: number) {
    const workspace = palette.actionsWorkspaces[index];
    if (!workspace || workspace.isActive) return;
    switchWorkspace(workspace.uuid);
  }

  function openExtensionByIndex(index: number) {
    const extension = palette.actionExtensions[index];
    if (!extension) return;
    openExtensionPopup(extension);
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
    if (palette.currentView === "duplicates" && selectedDuplicateTabRow) {
      closeDuplicateTab(selectedDuplicateTabRow);
      return;
    }
    if (palette.currentView === "duplicate-prompt" && selectedDuplicatePromptTabRow) {
      closeDuplicatePromptTab(selectedDuplicatePromptTabRow);
      return;
    }
    const row = selectedTabRow;
    if (!row) return;
    effects.closeTab(row.domId);
    const result = removeTabFromRows({ rows: palette.rows, total: palette.total, selectedIndex: palette.selectedIndex, domId: row.domId });
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
    if (palette.currentView === "duplicate-prompt") {
      const nextIndex = nextDuplicatePromptSectionIndex(selectionContext(), delta);
      if (nextIndex !== null) {
        paletteStore.selectIndex(nextIndex);
        scrollCurrentSelectionIntoView();
      }
      return;
    }
    if (!isCurrentActionsView()) return;
    const nextIndex = nextActionSectionIndex({
      sections: renderedActionSections,
      currentPage: palette.currentPage,
      visibleItemCount: visibleActionItems.length,
      selectedIndex: palette.selectedIndex,
      delta,
    });
    if (nextIndex !== null) {
      paletteStore.selectIndex(nextIndex);
      scrollCurrentSelectionIntoView();
    }
  }

  async function activateSelected(switchToTarget = false) {
    traceReplayForSelection(switchToTarget);

    if (palette.currentView === "actions") {
      const item = visibleActionItems[palette.selectedIndex];
      if (item) await activateAction(item);
      return;
    }

    if (isNativePrefixView(palette.currentView)) {
      const item = prefixItems[palette.selectedIndex];
      if (item) await activateAction(item);
      return;
    }

    const activation = resolveSelectionActivation(viewActivationContext(), { switchToTarget });
    if (CHROME_RESOLVED_ROW_VIEWS.has(palette.currentView)) {
      if (activation.kind === "none") return;
      activateChromeResolvedRow(palette.selectedIndex, "selection", switchToTarget);
      return;
    }

    await applyViewActivation(activation);
  }

  async function activateSelectedAndSwitch() {
    await activateSelected(true);
  }

  async function activateRow(index: number, switchToTarget = false) {
    traceReplayForListIndex(index, switchToTarget);
    const activation = resolveViewActivation(viewActivationContext(), index, "shortcut", { switchToTarget });
    if (CHROME_RESOLVED_ROW_VIEWS.has(palette.currentView)) {
      if (activation.kind === "none") return;
      activateChromeResolvedRow(index, "shortcut", switchToTarget);
      return;
    }
    await applyViewActivation(activation);
  }

  async function activateRenderedRow(index: number, switchToTarget = false) {
    if (palette.currentView === "navigation") {
      recordSyntheticChordKey(replayKeyForNavigationIndex(palette.navigationHistory, index));
    } else {
      traceReplayForListIndex(index, switchToTarget);
    }
    const activation = resolveViewActivation(viewActivationContext(), index, "selection", { switchToTarget });
    if (CHROME_RESOLVED_ROW_VIEWS.has(palette.currentView)) {
      if (activation.kind === "none") return;
      activateChromeResolvedRow(index, "selection", switchToTarget);
      return;
    }
    await applyViewActivation(activation);
  }

  async function activateRowAndSwitch(index: number) {
    await activateRow(index, true);
  }

  function viewActivationContext(): ViewActivationContext {
    return {
      view: palette.currentView,
      selectedIndex: palette.selectedIndex,
      offset: palette.offset,
      rows: palette.rows,
      navigationHistory: palette.navigationHistory,
      recentlyClosedRows: palette.recentlyClosedRows,
      workspaceRows: palette.workspaceRows,
      containerRows: palette.containerRows,
      folderRows: palette.folderRows,
      profileRows: palette.profileRows,
      duplicateTabs,
      duplicatePromptTabs,
    };
  }

  async function applyViewActivation(activation: ViewActivation) {
    await applyViewCommand(commandForViewActivation(activation));
  }

  async function applyViewCommand(command: ViewCommand) {
    if (command.kind === "message") {
      if (command.clearReveal) {
        markTerminalCommandDispatched();
        revealController.clear();
      }
      effects.sendViewCommand(command.message);
    } else if (command.kind === "open-domain") {
      await activateDomain({ kind: "domain", domain: command.domain, count: 0 });
    } else if (command.kind === "duplicate-prompt-action") {
      runDuplicatePromptAction(command.action);
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

  function tabAge(row: TabIndexRow) {
    const created = Number.parseInt(row.domId.split("-")[0] || "", 10);
    return formatDuration(Date.now() - created);
  }

  function tabSubtitle(row: TabIndexRow) {
    if (palette.currentView === "most-visited") return `${row.focusCount ?? 0} focuses`;
    if (palette.currentView === "tabs-by-age") return tabAge(row);
    return null;
  }

  async function runCommand(command: InteractionCommand) {
    await applyInteractionCommand(command, interactionRuntime);
  }

  async function handleKeyInput(input: BridgeKeyData) {
    if (terminalCommandStillBlocking()) {
      return false;
    }
    const actionNodes = palette.currentView === "actions" ? allActionNodes : isNativePrefixView(palette.currentView) ? prefixNodes : [];
    const command = interpretVisibleInput(
      { kind: "key", ...input },
      {
        view: palette.currentView,
        selectedIndex: palette.selectedIndex,
        duplicatePromptActionCount: DUPLICATE_PROMPT_ACTIONS.length,
      },
      actionNodes,
    );
    if (command.kind === "none") {
      return false;
    }

    if (command.kind === "action" || command.kind === "open-view" || command.kind === "enter-prefix") {
      traceReplayInput(input);
    }
    await runCommand(command);
    return true;
  }

  function handleBridgeKey(input: BridgeKeyData) {
    bridgeDispatch.queueOrHold(input);
  }

  function handleKeydown(event: KeyboardEvent) {
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

  async function handleWarmRearm(data: { inst?: number; view?: ViewId; params?: Record<string, unknown>; skipAnimations?: boolean }) {
    const generation = bridgeDispatch.resetForWarmRearm();
    revealController.updateInst(data.inst);
    skipAnimations = !!data.skipAnimations;
    suppressViewTransition = true;
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
      onCancelReveal: revealController.clear,
      onGoToActions: goToActions,
    });
    void initializeBridge(initialViewReady);
    return () => {
      revealController.clear();
      panelController.invalidate();
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("pagehide", handlePageHide);
      uninstallBridge();
    };
  });

  function handlePageHide() {
    pageAlive = false;
    revealController.markDead();
  }

  function goToActions() {
    if (!isCurrentActionsView()) {
      void openNativeView("actions").then(() => requestPanelResize("actions"));
    }
  }

  $effect(() => {
    if (selectedTabRow) {
      previewTab(selectedTabRow);
    } else if (selectedDuplicateTabRow) {
      previewTab(selectedDuplicateTabRow);
    } else if (selectedDuplicatePromptDomId) {
      previewTabLike({ domId: selectedDuplicatePromptDomId });
    } else if (palette.currentView === "duplicates") {
      clearPreview();
    } else if (palette.currentView === "duplicate-prompt") {
      clearPreview();
    } else if (palette.currentView === "actions") {
      clearPreview();
    }
  });
</script>

<PaletteShell
  {headerHidden}
  {title}
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
    actionSections={actionSectionsForRender}
    prefixItems={prefixItemsForRender}
    {tabRows}
    {domainRows}
    {selectedRowDomId}
    {selectedDomain}
    {activeWorkspaceId}
    {activateAction}
    {openExtensionPopup}
    {previewTabLike}
    {clearPreview}
    {activateRenderedRow}
    restoreClosedTabKeepOpen={(row) => restoreClosedTab(row, true)}
    {activateTab}
    {closeDuplicateTab}
    {closeDuplicatePromptTab}
    {previewTab}
    {closeTabInfoDuplicate}
    {closeOtherTabInfoDuplicates}
    {runDuplicatePromptAction}
    {drillParentRow}
    {loadVisibleRange}
    {tabSubtitle}
  />
</PaletteShell>
