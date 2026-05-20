<script lang="ts">
  import ExtensionStrip from "../components/ExtensionStrip.svelte";
  import { iconHtml } from "../components/icons";
  import type { ExtensionRow } from "../runtime/extension-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";
  import type { ActionMenuItem, ActionSection } from "./actions-model";
  import { domainOf } from "./url";

  type Props = {
    sections: ActionSection[];
    currentPage?: number;
    extensions?: ExtensionRow[];
    workspaces?: WorkspaceRow[];
    skipAnimations?: boolean;
    onactivate?: (item: ActionMenuItem) => void;
    onextension?: (index: number) => void;
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
  type PageModel = {
    page: number;
    blocks: PageBlock[];
  };

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

  function buildPageModels(sections: readonly ActionSection[]): PageModel[] {
    const pages = [...new Set(sections.map((section) => section.page))].sort((a, b) => a - b);
    return pages.map((page) => ({
      page,
      blocks: buildPageBlocks(sections.filter((section) => section.page === page)),
    }));
  }

  let {
    sections,
    currentPage = 1,
    extensions = [],
    workspaces = [],
    skipAnimations = false,
    onactivate,
    onextension,
    onpreview,
    onclearpreview,
  }: Props = $props();
  const pageModels = $derived(buildPageModels(sections));

  function actionIcon(item: ActionMenuItem) {
    if (item.iconHtml) return item.iconHtml;
    if (item.kind === "workspace-switch" && item.workspaceIconHtml) {
      return `<span class="workspace-icon">${item.workspaceIconHtml}</span>`;
    }
    if (item.kind === "workspace-switch") return "○";
    return iconHtml(item.icon);
  }

  function badgeLabel(value: string | null | undefined) {
    return value ? String(value) : "";
  }

  function scrollOverflow(node: HTMLElement) {
    const column = node.closest(".scrollable-column");
    let didScrollActive = false;
    let frame = 0;

    const update = () => {
      frame = 0;
      const overflowing = node.scrollHeight > node.clientHeight + 1;
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      column?.classList.toggle("has-overflow", overflowing && !atBottom);

      if (!didScrollActive) {
        didScrollActive = true;
        const active = node.querySelector<HTMLElement>(".ws-active");
        active?.scrollIntoView?.({ block: "nearest" });
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);

    node.addEventListener("scroll", schedule);
    resizeObserver?.observe(node);
    schedule();

    return {
      destroy() {
        node.removeEventListener("scroll", schedule);
        resizeObserver?.disconnect();
        if (frame) cancelAnimationFrame(frame);
        column?.classList.remove("has-overflow");
      },
    };
  }
</script>

{#snippet Badge(value: string | null | undefined)}
  {@const label = badgeLabel(value)}
  <span class={`item-badge${label.length > 1 ? " badge-wide" : ""}`} hidden={!label}>{label}</span>
{/snippet}

{#snippet ActionItem(item: ActionMenuItem, compact = false)}
  <button
    type="button"
    class="list-item"
    class:compact-item={compact}
    class:disabled={item.disabled}
    class:selected={Boolean(item.selected)}
    class:ws-active={item.kind === "workspace-switch" && item.disabled}
    data-id={item.id}
    disabled={item.disabled}
    onclick={() => onactivate?.(item)}
  >
    <span class="item-icon-placeholder">{@html actionIcon(item)}</span>
    <span class="item-text">
      <span class="item-title">
        {item.label}
        {#if item.kind === "workspace-switch" || (item.count ?? 0) > 0}
          <span class="item-count">{item.count ?? 0}</span>
        {/if}
      </span>
    </span>
    <span class="item-right">
      {@render Badge(item.badge)}
      <span class="item-arrow">{item.isView ? "›" : ""}</span>
    </span>
  </button>
{/snippet}

{#snippet NavigateItem(item: ActionMenuItem)}
  {@const preview = item.preview ?? null}
  {@const disabled = item.disabled || !preview}
  {@const workspace = preview?.workspaceId ? workspaces.find((row) => row.uuid === preview.workspaceId) : null}
  {@const historyDomain = preview?.isHistory ? domainOf(preview.url || "") : ""}
  <button
    type="button"
    class="navigate-cell list-item compact-item"
    class:disabled
    class:selected={Boolean(item.selected)}
    class:tab-pending={preview?.pending}
    data-id={item.id}
    disabled={disabled}
    onclick={() => {
      if (!disabled) onactivate?.(item);
    }}
    onmouseenter={() => {
      if (preview?.domId) onpreview?.(preview.domId);
    }}
    onmouseleave={() => onclearpreview?.()}
  >
    <span class="item-icon-placeholder">{@html item.iconHtml ?? iconHtml(item.icon)}</span>
    <span class="navigate-cell-label">{item.label}</span>
    <span class="navigate-cell-title">
      {#if preview && !preview.isHistory && preview.favIconUrl}
        <img class="navigate-cell-favicon" src={preview.favIconUrl} alt="" />
      {/if}
      {#if preview?.essential}
        <span class="tab-indicator essential" title="Essential">{@html iconHtml("svg:star")}</span>
      {:else if preview?.pinned}
        <span class="tab-indicator pinned" title="Pinned">{@html iconHtml("svg:pin")}</span>
      {/if}
      {preview?.title ?? ""}
    </span>
    {#if workspace && !preview?.isHistory}
      <span class="row-workspace">
        {#if workspace.svgContent}
          <span class="row-ws-icon">{@html workspace.svgContent}</span>
        {/if}
        {workspace.name}
      </span>
    {:else if historyDomain}
      <span class="row-workspace">{historyDomain}</span>
    {/if}
    {@render Badge(item.badge)}
  </button>
{/snippet}

<div class="actions-pager" class:no-anim={skipAnimations} style={`transform: translateX(-${(currentPage - 1) * 100}%)`}>
  {#each pageModels as page (page.page)}
    <div class="actions-page" data-page={page.page}>
      {#each page.blocks as block (blockKey(block))}
        {#if block.kind === "columns"}
          <div class="sections-row">
            {#each block.columns as column (column.id)}
              <div class="section-column" class:scrollable-column={column.scrollable}>
                {#each column.sections as section (`${section.id}-${section.page}`)}
                  <div class="list-section-header">{section.label}</div>
                  {#if section.scrollable}
                    <div class="section-scroll" use:scrollOverflow>
                      {#each section.items as item (item.id)}
                        {@render ActionItem(item, true)}
                      {/each}
                    </div>
                    <div class="section-scroll-fade"></div>
                  {:else}
                    {#each section.items as item (item.id)}
                      {@render ActionItem(item, true)}
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
                {@render NavigateItem(item)}
              {/each}
            </div>
          {:else}
            {#each block.section.items as item (item.id)}
              {@render ActionItem(item)}
            {/each}
          {/if}
        {/if}
      {/each}
      {#if page.page === 1}
        <ExtensionStrip {extensions} onactivate={onextension} />
      {/if}
    </div>
  {/each}
</div>
