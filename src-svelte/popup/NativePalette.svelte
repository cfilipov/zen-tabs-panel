<script lang="ts">
  import { onMount } from "svelte";
  import PaletteShell from "./components/PaletteShell.svelte";
  import ActionsMenu from "./views/ActionsMenu.svelte";
  import DomainList from "./views/DomainList.svelte";
  import PrefixMenu from "./views/PrefixMenu.svelte";
  import TabList from "./views/TabList.svelte";
  import { inputFromKeyboardEvent } from "./interaction/inputs";
  import { interpretVisibleInput, type InteractionCommand } from "./interaction/interpreter";
  import { fireMessage } from "./runtime/ipc";
  import { createTabIndexClient, type DomainIndexRow, type TabIndexRow, type TabIndexView } from "./runtime/tab-index-client";
  import {
    actionItemsForPage,
    actionNodesForSections,
    buildActionsMenuModel,
    prefixChildNodesForView,
    prefixItemsForView,
    type ActionMenuItem,
  } from "./views/actions-model";
  import type { ViewId } from "../shared/types";

  type NativeTabView = Extract<
    ViewId,
    "child-tabs" | "sibling-tabs" | "parent-tabs" | "last-visited" | "unvisited-tabs" | "tabs-by-age" | "domain-tabs"
  >;
  type NativeDomainView = Extract<ViewId, "domains">;
  type NativeListView = NativeTabView | NativeDomainView;
  type NativeRow = TabIndexRow | DomainIndexRow;
  type NativePrefixView = Extract<ViewId, "reorder-tabs" | "close-and-select" | "split-view">;

  const client = createTabIndexClient();
  const actionSections = buildActionsMenuModel();
  const listViewTitles: Record<NativeListView, string> = {
    "last-visited": "Recent",
    "unvisited-tabs": "New tabs",
    "tabs-by-age": "Tabs by age",
    "domain-tabs": "",
    "child-tabs": "Children",
    "sibling-tabs": "Siblings",
    "parent-tabs": "Parent tabs",
    "domains": "Domains",
  };

  let currentView = $state<ViewId>("actions");
  let rows = $state<NativeRow[]>([]);
  let total = $state(0);
  let offset = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let currentPage = $state(1);
  let selectedIndex = $state(0);
  let currentDomain = $state<string | null>(null);
  let loadGeneration = 0;

  const headerHidden = $derived(currentView === "actions");
  const pageCount = $derived(Math.max(1, Math.max(...actionSections.map((section) => section.page))));
  const visibleActionItems = $derived(actionItemsForPage(actionSections, currentPage));
  const allActionItems = $derived(actionSections.flatMap((section) => section.items));
  const allActionNodes = $derived(actionNodesForSections(actionSections));
  const prefixItems = $derived(isNativePrefixView(currentView) ? prefixItemsForView(currentView) : []);
  const prefixNodes = $derived(isNativePrefixView(currentView) ? prefixChildNodesForView(currentView) : []);
  const title = $derived(
    currentView === "domain-tabs" && currentDomain
      ? currentDomain
      : currentView in listViewTitles
      ? listViewTitles[currentView as NativeListView]
      : allActionItems.find((item) => item.view === currentView)?.label ?? "",
  );
  const selectedActionId = $derived(currentView === "actions" ? visibleActionItems[selectedIndex]?.id ?? null : null);
  const selectedPrefixId = $derived(isNativePrefixView(currentView) ? prefixItems[selectedIndex]?.id ?? null : null);
  const selectedRow = $derived(isNativeListView(currentView) ? rowForIndex(selectedIndex) : null);
  const selectedTabRow = $derived(isTabRow(selectedRow) ? selectedRow : null);
  const selectedDomainRow = $derived(isDomainRow(selectedRow) ? selectedRow : null);
  const tabRows = $derived(rows.filter(isTabRow));
  const domainRows = $derived(rows.filter(isDomainRow));
  const selectedRowDomId = $derived(selectedTabRow?.domId ?? null);
  const selectedDomain = $derived(selectedDomainRow?.domain ?? null);

  function isNativeListView(view: ViewId | undefined): view is NativeListView {
    return isNativeTabView(view) || view === "domains";
  }

  function isNativeTabView(view: ViewId | undefined): view is NativeTabView {
    return (
      view === "child-tabs" ||
      view === "sibling-tabs" ||
      view === "parent-tabs" ||
      view === "last-visited" ||
      view === "unvisited-tabs" ||
      view === "tabs-by-age" ||
      view === "domain-tabs"
    );
  }

  function isNativePrefixView(view: ViewId | undefined): view is NativePrefixView {
    return view === "reorder-tabs" || view === "close-and-select" || view === "split-view";
  }

  function isDomainRow(row: NativeRow | null): row is DomainIndexRow {
    return row?.kind === "domain";
  }

  function isTabRow(row: NativeRow | null): row is TabIndexRow {
    return !!row && row.kind !== "domain";
  }

  function viewParams(view: NativeListView) {
    return view === "domain-tabs" && currentDomain ? { domain: currentDomain } : {};
  }

  async function loadListView(view: NativeListView, nextOffset = 0, limit = 80, resetSelection = true, params = viewParams(view)) {
    const generation = ++loadGeneration;
    if (resetSelection) {
      loading = true;
    }
    error = null;
    currentView = view;
    offset = nextOffset;
    try {
      await client.ensureStarted();
      const win = await client.getWindow<NativeRow>(view as TabIndexView, nextOffset, limit, params);
      if (generation !== loadGeneration || currentView !== view) {
        return;
      }
      rows = win.rows;
      total = win.total;
      if (resetSelection) {
        selectedIndex = win.rows.length ? win.offset : -1;
      }
    } catch (err) {
      if (generation !== loadGeneration) {
        return;
      }
      rows = [];
      total = 0;
      selectedIndex = -1;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === loadGeneration) {
        loading = false;
      }
    }
  }

  function activateAction(item: ActionMenuItem) {
    if (item.disabled) {
      return;
    }

    if (item.kind === "action") {
      fireMessage({ type: item.id });
      return;
    }

    if (item.kind === "prefix" && isNativePrefixView(item.view as ViewId | undefined)) {
      currentView = item.view as NativePrefixView;
      selectedIndex = 0;
      error = null;
      return;
    }

    if (isNativeListView(item.view as ViewId | undefined)) {
      currentDomain = null;
      loadListView(item.view as NativeListView);
      return;
    }

    error = `${item.label} has not been ported to native Svelte yet`;
  }

  function activateTab(row: TabIndexRow) {
    fireMessage({ type: "activate-tab", domId: row.domId });
  }

  function activateDomain(row: DomainIndexRow) {
    currentDomain = row.domain;
    loadListView("domain-tabs", 0, 80, true, { domain: row.domain });
  }

  function previewTab(row: TabIndexRow) {
    fireMessage({ type: "preview-tab", domId: row.domId });
  }

  function clearPreview() {
    fireMessage({ type: "clear-preview" });
  }

  function goBack() {
    clearPreview();
    currentView = "actions";
    rows = [];
    total = 0;
    offset = 0;
    currentDomain = null;
    selectedIndex = 0;
    error = null;
  }

  function moveSelection(delta: 1 | -1) {
    const length = currentView === "actions"
      ? visibleActionItems.length
      : isNativePrefixView(currentView)
        ? prefixItems.length
        : rows.length;
    if (!length) {
      selectedIndex = -1;
      return;
    }

    const start = selectedIndex < 0 ? (delta > 0 ? -1 : 0) : selectedIndex;
    selectedIndex = (start + delta + length) % length;
    if (currentView !== "actions" && !isNativePrefixView(currentView)) {
      ensureListIndexLoaded(selectedIndex);
      scrollListIndexIntoView(selectedIndex);
    }
  }

  function cyclePage(delta: 1 | -1) {
    currentPage = ((currentPage - 1 + delta + pageCount) % pageCount) + 1;
    selectedIndex = 0;
  }

  function activateSelected() {
    if (currentView === "actions") {
      const item = visibleActionItems[selectedIndex];
      if (item) activateAction(item);
      return;
    }

    if (isNativePrefixView(currentView)) {
      const item = prefixItems[selectedIndex];
      if (item) activateAction(item);
      return;
    }

    if (selectedTabRow) activateTab(selectedTabRow);
    else if (selectedDomainRow) activateDomain(selectedDomainRow);
  }

  function activateRow(index: number) {
    const row = rowForIndex(index);
    if (isTabRow(row)) activateTab(row);
    else if (isDomainRow(row)) activateDomain(row);
  }

  function rowForIndex(index: number) {
    const relativeIndex = index - offset;
    return relativeIndex >= 0 ? rows[relativeIndex] ?? null : null;
  }

  function ensureListIndexLoaded(index: number) {
    if (!isNativeListView(currentView)) return;
    if (index >= offset && index < offset + rows.length) return;
    const nextOffset = Math.max(0, index - 20);
    loadListView(currentView, nextOffset, 80, false);
  }

  function scrollListIndexIntoView(index: number) {
    requestAnimationFrame(() => {
      const list = document.getElementById("list");
      if (!list) return;
      const rowHeight = 40;
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      if (top < list.scrollTop) {
        list.scrollTop = top;
      } else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
    });
  }

  function loadVisibleRange(nextOffset: number, limit: number) {
    if (!isNativeListView(currentView)) return;
    loadListView(currentView, nextOffset, Math.max(60, limit), false, viewParams(currentView));
  }

  function runCommand(command: InteractionCommand) {
    switch (command.kind) {
      case "action": {
        const item = [...allActionItems, ...prefixItems].find((candidate) => candidate.id === command.actionId);
        if (item) activateAction(item);
        return;
      }
      case "open-view":
        if (isNativeListView(command.view)) {
          currentDomain = null;
          loadListView(command.view);
        } else {
          currentView = command.view;
          rows = [];
          total = 0;
          selectedIndex = -1;
          const item = allActionItems.find((candidate) => candidate.view === command.view);
          error = `${item?.label ?? command.view} has not been ported to native Svelte yet`;
        }
        return;
      case "enter-prefix":
        if (isNativePrefixView(command.view)) {
          currentView = command.view;
          selectedIndex = 0;
          error = null;
        } else {
          currentView = command.view;
          rows = [];
          total = 0;
          selectedIndex = -1;
          error = `${command.view} has not been ported to native Svelte yet`;
        }
        return;
      case "cancel":
        fireMessage({ type: "hide-palette" });
        return;
      case "back":
        goBack();
        return;
      case "move-selection":
        moveSelection(command.delta);
        return;
      case "activate-selection":
        activateSelected();
        return;
      case "activate-row":
        activateRow(command.index);
        return;
      case "cycle-page":
        cyclePage(command.delta);
        return;
      case "none":
        return;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const actionNodes = currentView === "actions" ? allActionNodes : isNativePrefixView(currentView) ? prefixNodes : [];
    const command = interpretVisibleInput(inputFromKeyboardEvent(event), { view: currentView }, actionNodes);
    if (command.kind === "none") {
      return;
    }

    event.preventDefault();
    runCommand(command);
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const initialView = params.get("view") as ViewId | null;
    if (isNativeListView(initialView ?? undefined)) {
      currentDomain = params.get("domain");
      loadListView(initialView as NativeListView, 0, 80, true, viewParams(initialView as NativeListView));
    } else if (isNativePrefixView(initialView ?? undefined)) {
      currentView = initialView as NativePrefixView;
      selectedIndex = 0;
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  $effect(() => {
    if (selectedTabRow) {
      previewTab(selectedTabRow);
    } else if (currentView === "actions") {
      clearPreview();
    }
  });
</script>

<PaletteShell {headerHidden} {title} onback={currentView === "actions" ? undefined : goBack}>
  {#if error}
    <div class="empty-state">{error}</div>
  {:else if currentView === "actions"}
    <ActionsMenu sections={actionSections} {currentPage} selectedId={selectedActionId} onactivate={activateAction} />
  {:else if isNativePrefixView(currentView)}
    <PrefixMenu view={currentView} items={prefixItems} selectedId={selectedPrefixId} onactivate={activateAction} />
  {:else if loading}
    <div class="empty-state">Loading...</div>
  {:else if isNativeTabView(currentView)}
    <TabList
      rows={tabRows}
      {total}
      {offset}
      selectedDomId={selectedRowDomId}
      onactivate={activateTab}
      onpreview={previewTab}
      onclearpreview={clearPreview}
      onrange={loadVisibleRange}
    />
  {:else if currentView === "domains"}
    <DomainList
      rows={domainRows}
      {total}
      {offset}
      {selectedDomain}
      onactivate={activateDomain}
      onrange={loadVisibleRange}
    />
  {/if}
</PaletteShell>
