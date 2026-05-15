<script lang="ts">
  import ProfileRowView from "../components/ProfileRow.svelte";
  import type { ProfileRow } from "../runtime/profile-client";

  type Props = {
    rows: ProfileRow[];
    selectedIndex?: number;
    onactivate?: (row: ProfileRow) => void;
  };

  let { rows, selectedIndex = -1, onactivate }: Props = $props();
</script>

{#if rows.length === 0}
  <div class="empty-state">No profiles found</div>
{:else}
  {#each rows as row, index (row.rootPath ?? row.name)}
    <ProfileRowView
      {row}
      badge={index < 9 ? String(index + 1) : null}
      selected={index === selectedIndex}
      onactivate={onactivate}
    />
  {/each}
{/if}
