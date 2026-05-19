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
    ondrillchildren?: (row: TabIndexRow) => void;
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
    ondrillchildren,
    onpreview,
    onclearpreview,
    onrange,
    subtitle = () => null,
  }: Props = $props();
</script>

{#if total === 0}
  <div class="empty-state">No tabs</div>
{:else}
  <VirtualList {rows} {total} {offset} getKey={(row) => row.domId} onrange={onrange}>
    {#snippet children(row: TabIndexRow, index: number)}
      <TabRow
        {row}
        badge={offset + index < 9 ? String(offset + index + 1) : null}
        subtitle={subtitle(row)}
        {selectedDomId}
        {workspaces}
        {activeWorkspaceId}
        onactivate={onactivate}
        ondrillchildren={ondrillchildren}
        onpreview={onpreview}
        onclearpreview={onclearpreview}
      />
    {/snippet}
  </VirtualList>
{/if}
