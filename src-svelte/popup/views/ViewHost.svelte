<script lang="ts">
  import { fade } from "svelte/transition";
  import ActionsMenu from "./ActionsMenu.svelte";
  import ContainerList from "./ContainerList.svelte";
  import DomainList from "./DomainList.svelte";
  import DuplicateGroups from "./DuplicateGroups.svelte";
  import DuplicatePrompt from "./DuplicatePrompt.svelte";
  import FolderList from "./FolderList.svelte";
  import PrefixMenu from "./PrefixMenu.svelte";
  import NavigationList from "./NavigationList.svelte";
  import ProfileList from "./ProfileList.svelte";
  import RecentlyClosedList from "./RecentlyClosedList.svelte";
  import TabInfoView from "./TabInfoView.svelte";
  import TabList from "./TabList.svelte";
  import WorkspaceList from "./WorkspaceList.svelte";
  import type { ActionMenuItem, ActionSection } from "./actions-model";
  import type { DuplicatePromptAction } from "../interaction/duplicate-prompt-options";
  import type { ContainerRow } from "../runtime/container-client";
  import type { ExtensionRow } from "../runtime/extension-client";
  import type { FolderRow } from "../runtime/folder-client";
  import type { RecentlyClosedRow } from "../runtime/history-client";
  import type { ProfileRow } from "../runtime/profile-client";
  import type { HistoryVisit, TabInfo } from "../runtime/tab-info-client";
  import type { DomainIndexRow, DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";
  import type { NativePaletteState } from "../store/native-palette-state.svelte";
  import { isNativePrefixView, isNativeTabView } from "../view-loaders/view-registry";

  type Props = {
    palette: Readonly<NativePaletteState>;
    actionSections: ActionSection[];
    prefixItems: ActionMenuItem[];
    tabRows: TabIndexRow[];
    domainRows: DomainIndexRow[];
    selectedRowDomId: string | null;
    selectedDomain: string | null;
    activeWorkspaceId: string | null;
    activateAction: (item: ActionMenuItem) => void | Promise<void>;
    openExtensionPopup: (extension: ExtensionRow) => void;
    previewTabLike: (row: { domId: string }) => void;
    clearPreview: () => void;
    navigateToHistoryIndexWithTrace: (index: number) => void;
    restoreClosedTabWithTrace: (row: RecentlyClosedRow) => void;
    restoreClosedTabKeepOpen: (row: RecentlyClosedRow) => void;
    moveToWorkspaceWithTrace: (row: WorkspaceRow) => void;
    reopenInContainerWithTrace: (row: ContainerRow) => void;
    moveToFolderWithTrace: (row: FolderRow) => void;
    launchProfileWithTrace: (row: ProfileRow) => void;
    activateTab: (row: { domId: string }) => void;
    closeDuplicateTab: (row: TabIndexRow) => void;
    previewTab: (row: TabIndexRow) => void;
    closeTabInfoDuplicate: (row: TabIndexRow) => void;
    closeOtherTabInfoDuplicates: () => void;
    runDuplicatePromptAction: (action: DuplicatePromptAction) => void;
    activateTabRowWithTrace: (row: TabIndexRow) => void;
    loadVisibleRange: (offset: number, limit: number) => void;
    tabSubtitle: (row: TabIndexRow) => string | null;
    activateDomainWithTrace: (row: DomainIndexRow) => void | Promise<void>;
  };

  let {
    palette,
    actionSections,
    prefixItems,
    tabRows,
    domainRows,
    selectedRowDomId,
    selectedDomain,
    activeWorkspaceId,
    activateAction,
    openExtensionPopup,
    previewTabLike,
    clearPreview,
    navigateToHistoryIndexWithTrace,
    restoreClosedTabWithTrace,
    restoreClosedTabKeepOpen,
    moveToWorkspaceWithTrace,
    reopenInContainerWithTrace,
    moveToFolderWithTrace,
    launchProfileWithTrace,
    activateTab,
    closeDuplicateTab,
    previewTab,
    closeTabInfoDuplicate,
    closeOtherTabInfoDuplicates,
    runDuplicatePromptAction,
    activateTabRowWithTrace,
    loadVisibleRange,
    tabSubtitle,
    activateDomainWithTrace,
  }: Props = $props();

  function hasRenderableRows() {
    if (isNativeTabView(palette.currentView)) return tabRows.length > 0;
    if (palette.currentView === "domains") return domainRows.length > 0;
    if (palette.currentView === "navigation") return (palette.navigationHistory?.entries.length ?? 0) > 0;
    if (palette.currentView === "recently-closed") return palette.recentlyClosedRows.length > 0;
    if (palette.currentView === "move-to-workspace") return palette.workspaceRows.length > 0;
    if (palette.currentView === "open-in-container") return palette.containerRows.length > 0;
    if (palette.currentView === "move-to-folder") return palette.folderRows.length > 0;
    if (palette.currentView === "profiles") return palette.profileRows.length > 0;
    if (palette.currentView === "duplicates") return palette.duplicateGroups.length > 0;
    if (palette.currentView === "tab-info") return !!palette.tabInfo;
    if (palette.currentView === "duplicate-prompt") return !!palette.duplicatePromptUrl;
    return false;
  }
</script>

{#key palette.currentView}
  <div class="view-frame" in:fade={{ duration: 120 }}>
    {#if palette.error}
      <div class="empty-state">{palette.error}</div>
    {:else if palette.currentView === "actions"}
      <ActionsMenu
        sections={actionSections}
        currentPage={palette.currentPage}
        extensions={palette.actionExtensions}
        workspaces={palette.actionsWorkspaces}
        onactivate={activateAction}
        onextension={openExtensionPopup}
        onpreview={(domId) => previewTabLike({ domId })}
        onclearpreview={clearPreview}
      />
    {:else if isNativePrefixView(palette.currentView)}
      <PrefixMenu view={palette.currentView} items={prefixItems} onactivate={activateAction} />
    {:else if palette.loading && !hasRenderableRows()}
      <div class="empty-state">Loading...</div>
    {:else if palette.currentView === "navigation"}
      <NavigationList
        history={palette.navigationHistory}
        selectedIndex={palette.selectedIndex}
        onactivate={navigateToHistoryIndexWithTrace}
      />
    {:else if palette.currentView === "recently-closed"}
      <RecentlyClosedList
        rows={palette.recentlyClosedRows}
        selectedIndex={palette.selectedIndex}
        onactivate={restoreClosedTabWithTrace}
        onrestore={restoreClosedTabKeepOpen}
      />
    {:else if palette.currentView === "move-to-workspace"}
      <WorkspaceList
        rows={palette.workspaceRows}
        selectedIndex={palette.selectedIndex}
        onactivate={moveToWorkspaceWithTrace}
      />
    {:else if palette.currentView === "open-in-container"}
      <ContainerList
        rows={palette.containerRows}
        selectedIndex={palette.selectedIndex}
        onactivate={reopenInContainerWithTrace}
      />
    {:else if palette.currentView === "move-to-folder"}
      <FolderList
        rows={palette.folderRows}
        workspaces={palette.folderWorkspaces}
        selectedIndex={palette.selectedIndex}
        onactivate={moveToFolderWithTrace}
      />
    {:else if palette.currentView === "profiles"}
      <ProfileList
        rows={palette.profileRows}
        selectedIndex={palette.selectedIndex}
        onactivate={launchProfileWithTrace}
      />
    {:else if palette.currentView === "duplicates"}
      <DuplicateGroups
        groups={palette.duplicateGroups}
        workspaces={palette.duplicateWorkspaces}
        onactivate={activateTab}
        onclose={closeDuplicateTab}
        onpreview={previewTab}
        onclearpreview={clearPreview}
      />
    {:else if palette.currentView === "tab-info"}
      <TabInfoView
        info={palette.tabInfo as TabInfo | null}
        visits={palette.tabInfoVisits as HistoryVisit[]}
        duplicates={palette.tabInfoDuplicates}
        workspaces={palette.tabInfoWorkspaces}
        onactivate={activateTab}
        onclose={closeTabInfoDuplicate}
        oncloseothers={closeOtherTabInfoDuplicates}
        onpreview={previewTabLike}
        onclearpreview={clearPreview}
      />
    {:else if palette.currentView === "duplicate-prompt"}
      <DuplicatePrompt
        url={palette.duplicatePromptUrl}
        existingDomId={palette.duplicatePromptDomId}
        selectedIndex={palette.selectedIndex}
        onactivate={runDuplicatePromptAction}
        onpreview={(domId) => previewTabLike({ domId })}
        onclearpreview={clearPreview}
      />
    {:else if isNativeTabView(palette.currentView)}
      <TabList
        rows={tabRows}
        total={palette.total}
        offset={palette.offset}
        selectedDomId={selectedRowDomId}
        workspaces={palette.sidebarWorkspaces}
        {activeWorkspaceId}
        onactivate={activateTabRowWithTrace}
        onpreview={previewTab}
        onclearpreview={clearPreview}
        onrange={loadVisibleRange}
        subtitle={tabSubtitle}
      />
    {:else if palette.currentView === "domains"}
      <DomainList
        rows={domainRows}
        total={palette.total}
        offset={palette.offset}
        {selectedDomain}
        onactivate={activateDomainWithTrace}
        onrange={loadVisibleRange}
      />
    {/if}
  </div>
{/key}
