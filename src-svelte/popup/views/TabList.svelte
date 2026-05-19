<script lang="ts">
  import TabRow from "../components/TabRow.svelte";
  import VirtualList from "../components/VirtualList.svelte";
  import type { TabIndexRow } from "../runtime/tab-index-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type Props = {
    rows: TabIndexRow[];
    total: number;
    offset?: number;
    selectedDomId?: string | null;
    workspaces?: WorkspaceRow[];
    activeWorkspaceId?: string | null;
    onactivate?: (row: TabIndexRow) => void;
    onpreview?: (row: TabIndexRow) => void;
    onclearpreview?: () => void;
    onrange?: (offset: number, limit: number) => void;
    subtitle?: (row: TabIndexRow) => string | null;
  };

  let {
    rows,
    total,
    offset = 0,
    selectedDomId = null,
    workspaces = [],
    activeWorkspaceId = null,
    onactivate,
    onpreview,
    onclearpreview,
    onrange,
    subtitle = () => null,
  }: Props = $props();
</script>

{#if total === 0}
  <div class="empty-state">No tabs</div>
{:else}
  <VirtualList {rows} {total} {offset} onrange={onrange}>
    {#snippet children(row: TabIndexRow, index: number)}
      <TabRow
        {row}
        badge={offset + index < 9 ? String(offset + index + 1) : null}
        subtitle={subtitle(row)}
        {selectedDomId}
        {workspaces}
        {activeWorkspaceId}
        onactivate={onactivate}
        onpreview={onpreview}
        onclearpreview={onclearpreview}
      />
    {/snippet}
  </VirtualList>
{/if}
