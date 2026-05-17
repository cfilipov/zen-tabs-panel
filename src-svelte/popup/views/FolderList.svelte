<script lang="ts">
  import FolderRowView from "../components/FolderRow.svelte";
  import type { FolderRow } from "../runtime/folder-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type Props = {
    rows: FolderRow[];
    workspaces?: WorkspaceRow[];
    selectedIndex?: number;
    onactivate?: (row: FolderRow) => void;
  };

  let { rows, workspaces = [], selectedIndex = -1, onactivate }: Props = $props();
  const workspaceById = $derived(new Map(workspaces.map((workspace) => [workspace.uuid, workspace])));
</script>

{#if rows.length === 0}
  <div class="empty-state">No folders</div>
{:else}
  {#each rows as row, index (row.id)}
    <FolderRowView
      {row}
      {index}
      {selectedIndex}
      workspaceName={row.workspaceId ? workspaceById.get(row.workspaceId)?.name ?? null : null}
      badge={index < 9 ? String(index + 1) : null}
      onactivate={onactivate}
    />
  {/each}
{/if}
