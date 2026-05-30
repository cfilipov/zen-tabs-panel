<script lang="ts">
  import { tick } from "svelte";
  import TabRow from "../components/TabRow.svelte";
  import VirtualList from "../components/VirtualList.svelte";
  import type { TabIndexRow } from "../runtime/tab-index-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type Props = {
    rows: TabIndexRow[];
    total: number;
    offset?: number;
    skipAnimations?: boolean;
    selectedDomId?: string | null;
    workspaces?: WorkspaceRow[];
    activeWorkspaceId?: string | null;
    searchActive?: boolean;
    searchQuery?: string;
    onsearchquery?: (query: string) => void;
    onsearchdismiss?: () => void;
    onactivate?: (index: number) => void;
    ondrillchildren?: (row: TabIndexRow) => void;
    onclose?: (row: TabIndexRow) => void;
    onpreview?: (row: TabIndexRow) => void;
    onclearpreview?: () => void;
    onrange?: (offset: number, limit: number) => void;
    subtitle?: (row: TabIndexRow) => string | null;
  };

  let {
    rows,
    total,
    offset = 0,
    skipAnimations = false,
    selectedDomId = null,
    workspaces = [],
    activeWorkspaceId = null,
    searchActive = false,
    searchQuery = "",
    onsearchquery,
    onsearchdismiss,
    onactivate,
    ondrillchildren,
    onclose,
    onpreview,
    onclearpreview,
    onrange,
    subtitle = () => null,
  }: Props = $props();

  let input: HTMLInputElement | null = $state(null);

  function handleInput(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    onsearchquery?.(target.value);
  }

  function inputOwnsKey(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key === "Escape" || event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter") return false;
    if (event.key === "Backspace" && searchQuery.length === 0) return false;
    return event.key.length === 1 ||
      event.key === "Backspace" ||
      event.key === "Delete" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight";
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Backspace" && searchQuery.length === 0) {
      event.preventDefault();
      event.stopPropagation();
      onsearchdismiss?.();
      return;
    }
    if (inputOwnsKey(event)) event.stopPropagation();
  }

  $effect(() => {
    if (!searchActive) return;
    void tick().then(() => {
      input?.focus();
      input?.select();
    });
  });
</script>

{#if searchActive}
  <div class="tab-list-search-wrap">
    <input
      bind:this={input}
      class="tab-list-search"
      type="search"
      placeholder="Search tabs"
      autocomplete="off"
      spellcheck="false"
      value={searchQuery}
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
  </div>
{/if}

{#if total === 0}
  <div class="empty-state">No tabs</div>
{:else}
  <VirtualList {rows} {total} {offset} {skipAnimations} getKey={(row) => row.domId} onrange={onrange}>
    {#snippet children(row: TabIndexRow, index: number)}
      <TabRow
        {row}
        index={offset + index}
        badge={offset + index < 9 ? String(offset + index + 1) : null}
        subtitle={subtitle(row)}
        {selectedDomId}
        {workspaces}
        {activeWorkspaceId}
        onactivate={onactivate}
        ondrillchildren={ondrillchildren}
        onclose={onclose}
        onpreview={onpreview}
        onclearpreview={onclearpreview}
      />
    {/snippet}
  </VirtualList>
{/if}
