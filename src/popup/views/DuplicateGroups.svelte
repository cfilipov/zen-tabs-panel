<script lang="ts">
  import type { DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";
  import DuplicateGroupSection from "./DuplicateGroupSection.svelte";

  type Props = {
    groups: DuplicateGroupRow[];
    workspaces?: WorkspaceRow[];
    selectedIndex?: number;
    onactivate?: (row: TabIndexRow) => void;
    onclose?: (row: TabIndexRow) => void;
    onpreview?: (row: TabIndexRow) => void;
    onclearpreview?: () => void;
  };

  let {
    groups,
    workspaces = [],
    selectedIndex = -1,
    onactivate,
    onclose,
    onpreview,
    onclearpreview,
  }: Props = $props();

  const groupSections = $derived((() => {
    let offset = 0;
    return groups.map((group) => {
      const groupSelectedIndex = selectedIndex >= offset && selectedIndex < offset + group.tabs.length
        ? selectedIndex - offset
        : -1;
      offset += group.tabs.length;
      return { group, selectedIndex: groupSelectedIndex };
    });
  })());

</script>

{#if groups.length === 0}
  <div class="empty-state">No duplicates</div>
{:else}
  {#each groupSections as section (section.group.url)}
    <DuplicateGroupSection
      group={section.group}
      {workspaces}
      selectedIndex={section.selectedIndex}
      {onactivate}
      {onclose}
      {onpreview}
      {onclearpreview}
    />
  {/each}
{/if}
