<script lang="ts">
  import WorkspaceRowView from "../components/WorkspaceRow.svelte";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type Props = {
    rows: WorkspaceRow[];
    selectedIndex?: number;
    onactivate?: (row: WorkspaceRow) => void;
  };

  let { rows, selectedIndex = -1, onactivate }: Props = $props();
</script>

{#if rows.length === 0}
  <div class="empty-state">No other workspaces</div>
{:else}
  {#each rows as row, index (row.uuid)}
    <WorkspaceRowView
      {row}
      {index}
      {selectedIndex}
      badge={index < 9 ? String(index + 1) : null}
      onactivate={onactivate}
    />
  {/each}
{/if}
