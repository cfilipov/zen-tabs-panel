<script lang="ts">
  import { fade } from "svelte/transition";
  import ActionsMenu from "./ActionsMenu.svelte";
  import ContainerList from "./ContainerList.svelte";
  import DomainCloseConfirm from "./DomainCloseConfirm.svelte";
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
  import WorkspaceIconPicker from "./WorkspaceIconPicker.svelte";
  import WorkspaceNameEditor from "./WorkspaceNameEditor.svelte";
  import WorkspaceList from "./WorkspaceList.svelte";
  import type { ActionMenuItem, ActionSection } from "./actions-model";
  import type { DomainCloseConfirmAction } from "../interaction/domain-close-confirm-options";
  import type { DuplicatePromptAction } from "../interaction/duplicate-prompt-options";
  import type { HistoryVisit, TabInfo } from "../runtime/tab-info-client";
  import type { DomainIndexRow, DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";
  import type { NativePaletteState } from "../store/native-palette-state.svelte";
  import { isNativePrefixView, isNativeTabView } from "../view-loaders/view-registry";

  type Props = {
    palette: Readonly<NativePaletteState>;
    skipAnimations?: boolean;
    loading: boolean;
    error: string | null;
    actionSections: ActionSection[];
    prefixItems: ActionMenuItem[];
    tabRows: TabIndexRow[];
    domainRows: DomainIndexRow[];
    tabInfo: TabInfo | null;
    tabInfoVisits: HistoryVisit[];
    tabInfoDuplicates: TabIndexRow[];
    tabInfoWorkspaces: NativePaletteState["tabInfoWorkspaces"];
    selectedRowDomId: string | null;
    selectedDomain: string | null;
    activeWorkspaceId: string | null;
    activateAction: (item: ActionMenuItem) => void | Promise<void>;
    openExtensionPopup: (index: number) => void | Promise<void>;
    previewTabLike: (row: { domId: string }) => void;
    clearPreview: () => void;
    activateRenderedRow: (index: number, switchToTarget?: boolean) => void | Promise<void>;
    restoreClosedTabKeepOpen: (row: NativePaletteState["recentlyClosedRows"][number]) => void;
    activateTab: (row: { domId: string }) => void;
    activateDuplicatePromptTab: (row: TabIndexRow, index: number) => void | Promise<void>;
    activateTabInfoDuplicate: (row: TabIndexRow, index: number) => void | Promise<void>;
    closeDuplicateTab: (row: TabIndexRow) => void;
    closeDuplicatePromptTab: (row: TabIndexRow) => void;
    closeTabRow: (row: TabIndexRow) => void;
    closeDomainRow: (row: DomainIndexRow) => void | Promise<void>;
    previewTab: (row: TabIndexRow) => void;
    closeTabInfoDuplicate: (row: TabIndexRow) => void;
    closeOtherTabInfoDuplicates: () => void;
    runDuplicatePromptAction: (action: DuplicatePromptAction) => void;
    runDomainCloseConfirmAction: (action: DomainCloseConfirmAction) => void;
    setActiveWorkspaceIcon: (kind: "emoji" | "zen" | "lucide", value: string) => void | Promise<void>;
    setActiveWorkspaceName: (name: string) => void | Promise<void>;
    drillParentRow: (row: TabIndexRow) => void | Promise<void>;
    loadVisibleRange: (offset: number, limit: number) => void;
    tabSubtitle: (row: TabIndexRow) => string | null;
    setActionsPage: (page: number) => void;
  };

  let {
    palette,
    skipAnimations = false,
    loading,
    error,
    actionSections,
    prefixItems,
    tabRows,
    domainRows,
    tabInfo,
    tabInfoVisits,
    tabInfoDuplicates,
    tabInfoWorkspaces,
    selectedRowDomId,
    selectedDomain,
    activeWorkspaceId,
    activateAction,
    openExtensionPopup,
    previewTabLike,
    clearPreview,
    activateRenderedRow,
    restoreClosedTabKeepOpen,
    activateTab,
    activateDuplicatePromptTab,
    activateTabInfoDuplicate,
    closeDuplicateTab,
    closeDuplicatePromptTab,
    closeTabRow,
    closeDomainRow,
    previewTab,
    closeTabInfoDuplicate,
    closeOtherTabInfoDuplicates,
    runDuplicatePromptAction,
    runDomainCloseConfirmAction,
    setActiveWorkspaceIcon,
    setActiveWorkspaceName,
    drillParentRow,
    loadVisibleRange,
    tabSubtitle,
    setActionsPage,
  }: Props = $props();

  function hasRenderableRows() {
    if (isNativeTabView(palette.currentView)) return tabRows.length > 0;
    if (palette.currentView === "domains") return domainRows.length > 0;
    if (palette.currentView === "navigation") return (palette.navigationHistory?.entries.length ?? 0) > 0;
    if (palette.currentView === "recently-closed") return palette.recentlyClosedRows.length > 0;
    if (palette.currentView === "move-to-workspace") return palette.workspaceRows.length > 0;
    if (palette.currentView === "open-in-container" || palette.currentView === "workspace-profiles") return palette.containerRows.length > 0;
    if (palette.currentView === "move-to-folder") return palette.folderRows.length > 0;
    if (palette.currentView === "profiles") return palette.profileRows.length > 0;
    if (palette.currentView === "workspace-icons") return palette.workspaceIconWorkspaces.length > 0;
    if (palette.currentView === "workspace-name") return !loading;
    if (palette.currentView === "domain-close-confirm") return !!palette.domainCloseDomain;
    if (palette.currentView === "duplicates") return palette.duplicateGroups.length > 0;
    if (palette.currentView === "tab-info") return !!tabInfo;
    if (palette.currentView === "duplicate-prompt") return !!palette.duplicatePromptUrl;
    return false;
  }
</script>

{#key palette.currentView}
  <div class="view-frame" data-skip-animations={skipAnimations ? "true" : "false"} in:fade={{ duration: skipAnimations ? 0 : 120 }}>
    {#if error}
      <div class="empty-state">{error}</div>
    {:else if palette.currentView === "actions"}
      <ActionsMenu
        sections={actionSections}
        currentPage={palette.currentPage}
        extensions={palette.actionExtensions}
        workspaces={palette.actionsWorkspaces}
        {skipAnimations}
        onactivate={activateAction}
        onextension={openExtensionPopup}
        onpreview={(domId) => previewTabLike({ domId })}
        onclearpreview={clearPreview}
        onpage={setActionsPage}
      />
    {:else if isNativePrefixView(palette.currentView)}
      <PrefixMenu view={palette.currentView} items={prefixItems} onactivate={activateAction} />
    {:else if loading && !hasRenderableRows()}
      <div class="empty-state">Loading...</div>
    {:else if palette.currentView === "navigation"}
      <NavigationList
        history={palette.navigationHistory}
        selectedIndex={palette.selectedIndex}
        onactivate={activateRenderedRow}
      />
    {:else if palette.currentView === "recently-closed"}
      <RecentlyClosedList
        rows={palette.recentlyClosedRows}
        selectedIndex={palette.selectedIndex}
        onactivate={activateRenderedRow}
        onrestore={restoreClosedTabKeepOpen}
      />
    {:else if palette.currentView === "move-to-workspace"}
      <WorkspaceList
        rows={palette.workspaceRows}
        selectedIndex={palette.selectedIndex}
        onactivate={activateRenderedRow}
      />
    {:else if palette.currentView === "open-in-container" || palette.currentView === "workspace-profiles"}
      <ContainerList
        rows={palette.containerRows}
        selectedIndex={palette.selectedIndex}
        onactivate={activateRenderedRow}
      />
    {:else if palette.currentView === "move-to-folder"}
      <FolderList
        rows={palette.folderRows}
        workspaces={palette.folderWorkspaces}
        selectedIndex={palette.selectedIndex}
        onactivate={activateRenderedRow}
      />
    {:else if palette.currentView === "profiles"}
      <ProfileList
        rows={palette.profileRows}
        selectedIndex={palette.selectedIndex}
        onactivate={activateRenderedRow}
      />
    {:else if palette.currentView === "workspace-icons"}
      <WorkspaceIconPicker
        workspaces={palette.workspaceIconWorkspaces}
        zenIcons={palette.zenWorkspaceIcons}
        onselect={setActiveWorkspaceIcon}
      />
    {:else if palette.currentView === "workspace-name"}
      <WorkspaceNameEditor name={palette.workspaceName} onsave={setActiveWorkspaceName} />
    {:else if palette.currentView === "duplicates"}
      <DuplicateGroups
        groups={palette.duplicateGroups}
        workspaces={palette.duplicateWorkspaces}
        selectedIndex={palette.selectedIndex}
        onactivate={activateRenderedRow}
        onclose={closeDuplicateTab}
        onpreview={previewTab}
        onclearpreview={clearPreview}
      />
    {:else if palette.currentView === "tab-info"}
      <TabInfoView
        info={tabInfo}
        visits={tabInfoVisits}
        duplicates={tabInfoDuplicates}
        workspaces={tabInfoWorkspaces}
        onactivate={activateTab}
        onduplicateactivate={activateTabInfoDuplicate}
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
        group={palette.duplicatePromptGroup}
        workspaces={palette.duplicatePromptWorkspaces}
        onactivate={runDuplicatePromptAction}
        ontabactivate={activateDuplicatePromptTab}
        onclose={closeDuplicatePromptTab}
        onpreview={(domId) => previewTabLike({ domId })}
        onclearpreview={clearPreview}
      />
    {:else if isNativeTabView(palette.currentView)}
      <TabList
        rows={tabRows}
        total={palette.total}
        offset={palette.offset}
        {skipAnimations}
        selectedDomId={selectedRowDomId}
        workspaces={palette.sidebarWorkspaces}
        {activeWorkspaceId}
        onactivate={activateRenderedRow}
        ondrillchildren={drillParentRow}
        onclose={closeTabRow}
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
        {skipAnimations}
        {selectedDomain}
        onactivate={activateRenderedRow}
        onclose={closeDomainRow}
        onrange={loadVisibleRange}
      />
    {:else if palette.currentView === "domain-close-confirm"}
      <DomainCloseConfirm
        domain={palette.domainCloseDomain}
        count={palette.domainCloseCount}
        unpinnedCount={palette.domainCloseUnpinnedCount}
        pinnedCount={palette.domainClosePinnedCount}
        selectedIndex={palette.selectedIndex}
        onactivate={runDomainCloseConfirmAction}
      />
    {/if}
  </div>
{/key}
