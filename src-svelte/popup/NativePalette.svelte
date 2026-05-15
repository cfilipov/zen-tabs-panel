<script lang="ts">
  import { onMount } from "svelte";
  import PaletteShell from "./components/PaletteShell.svelte";
  import ActionsMenu from "./views/ActionsMenu.svelte";
  import TabList from "./views/TabList.svelte";
  import { fireMessage } from "./runtime/ipc";
  import { createTabIndexClient, type TabIndexRow, type TabIndexView } from "./runtime/tab-index-client";
  import { buildActionsMenuModel, type ActionMenuItem } from "./views/actions-model";
  import type { ViewId } from "../shared/types";

  type NativeListView = Extract<ViewId, "last-visited" | "unvisited-tabs" | "tabs-by-age">;

  const client = createTabIndexClient();
  const actionSections = buildActionsMenuModel();
  const listViewTitles: Record<NativeListView, string> = {
    "last-visited": "Recent",
    "unvisited-tabs": "New tabs",
    "tabs-by-age": "Tabs by age",
  };

  let currentView = $state<ViewId>("actions");
  let rows = $state<TabIndexRow[]>([]);
  let total = $state(0);
  let offset = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);

  const headerHidden = $derived(currentView === "actions");
  const title = $derived(currentView in listViewTitles ? listViewTitles[currentView as NativeListView] : "");

  function isNativeListView(view: ViewId | undefined): view is NativeListView {
    return view === "last-visited" || view === "unvisited-tabs" || view === "tabs-by-age";
  }

  async function loadListView(view: NativeListView, nextOffset = 0) {
    loading = true;
    error = null;
    currentView = view;
    offset = nextOffset;
    try {
      await client.ensureStarted();
      const win = await client.getWindow<TabIndexRow>(view as TabIndexView, nextOffset, 60);
      rows = win.rows;
      total = win.total;
    } catch (err) {
      rows = [];
      total = 0;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function activateAction(item: ActionMenuItem) {
    if (item.kind === "action") {
      fireMessage({ type: item.id });
      return;
    }

    if (isNativeListView(item.view as ViewId | undefined)) {
      loadListView(item.view as NativeListView);
      return;
    }

    error = `${item.label} has not been ported to native Svelte yet`;
  }

  function activateTab(row: TabIndexRow) {
    fireMessage({ type: "activate-tab", domId: row.domId });
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
    error = null;
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const initialView = params.get("view") as ViewId | null;
    if (isNativeListView(initialView ?? undefined)) {
      loadListView(initialView as NativeListView);
    }
  });
</script>

<PaletteShell {headerHidden} {title} onback={currentView === "actions" ? undefined : goBack}>
  {#if error}
    <div class="empty-state">{error}</div>
  {:else if currentView === "actions"}
    <ActionsMenu sections={actionSections} onactivate={activateAction} />
  {:else if loading}
    <div class="empty-state">Loading...</div>
  {:else if isNativeListView(currentView)}
    <TabList
      {rows}
      {total}
      {offset}
      onactivate={activateTab}
      onpreview={previewTab}
      onclearpreview={clearPreview}
    />
  {/if}
</PaletteShell>
