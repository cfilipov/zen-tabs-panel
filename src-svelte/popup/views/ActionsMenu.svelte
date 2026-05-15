<script lang="ts">
  import ActionRow from "../components/ActionRow.svelte";
  import ExtensionStrip from "../components/ExtensionStrip.svelte";
  import NavigateActionRow from "../components/NavigateActionRow.svelte";
  import type { ExtensionRow } from "../runtime/extension-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";
  import type { ActionMenuItem, ActionSection } from "./actions-model";

  type Props = {
    sections: ActionSection[];
    currentPage?: number;
    selectedId?: string | null;
    extensions?: ExtensionRow[];
    workspaces?: WorkspaceRow[];
    onactivate?: (item: ActionMenuItem) => void;
    onextension?: (extension: ExtensionRow) => void;
    onpreview?: (domId: string) => void;
    onclearpreview?: () => void;
  };

  type SectionBlock = {
    kind: "section";
    section: ActionSection;
  };

  type ColumnBlock = {
    kind: "columns";
    id: string;
    columns: Array<{
      id: string;
      scrollable: boolean;
      sections: ActionSection[];
    }>;
  };

  type PageBlock = SectionBlock | ColumnBlock;

  function buildPageBlocks(sections: readonly ActionSection[]): PageBlock[] {
    const blocks: PageBlock[] = [];
    let columnBlock: ColumnBlock | null = null;
    let currentColumn: ColumnBlock["columns"][number] | null = null;

    for (const section of sections) {
      if (!section.column) {
        columnBlock = null;
        currentColumn = null;
        blocks.push({ kind: "section", section });
        continue;
      }

      if (!columnBlock) {
        columnBlock = { kind: "columns", id: `columns-${section.page}-${section.id}`, columns: [] };
        blocks.push(columnBlock);
      }

      if (!section.stack || !currentColumn) {
        currentColumn = {
          id: `column-${section.page}-${section.id}`,
          scrollable: Boolean(section.scrollable),
          sections: [],
        };
        columnBlock.columns.push(currentColumn);
      }

      currentColumn.sections.push(section);
      currentColumn.scrollable ||= Boolean(section.scrollable);
    }

    return blocks;
  }

  function blockKey(block: PageBlock): string {
    return block.kind === "columns" ? block.id : `${block.section.id}-${block.section.page}`;
  }

  let {
    sections,
    currentPage = 1,
    selectedId = null,
    extensions = [],
    workspaces = [],
    onactivate,
    onextension,
    onpreview,
    onclearpreview,
  }: Props = $props();
  const pageSections = $derived(sections.filter((section) => section.page === currentPage));
  const pageBlocks = $derived(buildPageBlocks(pageSections));
</script>

<div class="actions-pager no-anim" style={`transform: translateX(-${(currentPage - 1) * 100}%)`}>
  <div class="actions-page" data-page={currentPage}>
    {#each pageBlocks as block (blockKey(block))}
      {#if block.kind === "columns"}
        <div class="sections-row">
          {#each block.columns as column (column.id)}
            <div class="section-column" class:scrollable-column={column.scrollable}>
              {#each column.sections as section (`${section.id}-${section.page}`)}
                <div class="list-section-header">{section.label}</div>
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
              {/each}
            </div>
          {/each}
        </div>
      {:else}
        <div class="list-section-header">{block.section.label}</div>
        {#if block.section.navigateGrid}
          <div class="navigate-grid">
            {#each block.section.items as item (item.id)}
              <NavigateActionRow
                {item}
                {workspaces}
                selected={item.id === selectedId}
                onactivate={onactivate}
                onpreview={onpreview}
                onclearpreview={onclearpreview}
              />
            {/each}
          </div>
        {:else}
          {#each block.section.items as item (item.id)}
            <ActionRow {item} selected={item.id === selectedId} onactivate={onactivate} />
          {/each}
        {/if}
      {/if}
    {/each}
    {#if currentPage === 1}
      <ExtensionStrip {extensions} onactivate={onextension} />
    {/if}
  </div>
</div>
