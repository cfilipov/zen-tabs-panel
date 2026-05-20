<script lang="ts">
  import WorkspaceRowView from "../components/WorkspaceRow.svelte";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type Props = {
    rows: WorkspaceRow[];
    selectedIndex?: number;
    onactivate?: (row: WorkspaceRow, switchToTarget?: boolean) => void;
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
  <div class="list-hint-divider"></div>
  <div class="list-bottom-hint">
    <span>⇧1-⇧9, ⇧Enter, or Shift-click moves the tab and switches to that workspace.</span>
  </div>
{/if}
