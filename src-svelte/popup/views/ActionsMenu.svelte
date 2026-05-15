<script lang="ts">
  import ActionRow from "../components/ActionRow.svelte";
  import ExtensionStrip from "../components/ExtensionStrip.svelte";
  import type { ExtensionRow } from "../runtime/extension-client";
  import type { ActionMenuItem, ActionSection } from "./actions-model";

  type Props = {
    sections: ActionSection[];
    currentPage?: number;
    selectedId?: string | null;
    extensions?: ExtensionRow[];
    onactivate?: (item: ActionMenuItem) => void;
    onextension?: (extension: ExtensionRow) => void;
  };

  let { sections, currentPage = 1, selectedId = null, extensions = [], onactivate, onextension }: Props = $props();
  const pageSections = $derived(sections.filter((section) => section.page === currentPage));
</script>

<div class="actions-pager no-anim" style={`transform: translateX(-${(currentPage - 1) * 100}%)`}>
  <div class="actions-page" data-page={currentPage}>
    {#each pageSections as section (`${section.id}-${section.page}`)}
      <div class="list-section-header">{section.label}</div>
      {#if section.navigateGrid}
        <div class="navigate-grid">
          {#each section.items as item (item.id)}
            <ActionRow {item} compact selected={item.id === selectedId} onactivate={onactivate} />
          {/each}
        </div>
      {:else if section.column}
        <div class="sections-row">
          <div class="section-column" class:scrollable-column={section.scrollable}>
            {#if section.scrollable}
              <div class="section-scroll">
                {#each section.items as item (item.id)}
                  <ActionRow {item} compact selected={item.id === selectedId} onactivate={onactivate} />
                {/each}
              </div>
              <div class="section-scroll-fade"></div>
            {:else}
              {#each section.items as item (item.id)}
                <ActionRow {item} compact selected={item.id === selectedId} onactivate={onactivate} />
              {/each}
            {/if}
          </div>
        </div>
      {:else}
        {#each section.items as item (item.id)}
          <ActionRow {item} selected={item.id === selectedId} onactivate={onactivate} />
        {/each}
      {/if}
    {/each}
    {#if currentPage === 1}
      <ExtensionStrip {extensions} onactivate={onextension} />
    {/if}
  </div>
</div>
