<script lang="ts">
  import { tick } from "svelte";
  import { WORKSPACE_ICON_PAGES, type WorkspaceIconKind } from "../interaction/workspace-icon-pages";
  import { WORKSPACE_EMOJIS } from "../data/workspace-emojis";
  import { LUCIDE_ICONS } from "../generated/lucide-icons";
  import Badge from "../components/Badge.svelte";
  import type { WorkspaceRow, ZenWorkspaceIconRow } from "../runtime/workspace-client";

  type RuntimeLike = {
    runtime: {
      getURL(path: string): string;
    };
  };

  type IconKind = WorkspaceIconKind;
  type IconChoice = {
    kind: IconKind;
    value: string;
    label: string;
    terms: readonly string[];
    emoji?: string;
    svgContent?: string;
    src?: string;
  };

  declare const browser: RuntimeLike | undefined;
  declare const chrome: RuntimeLike | undefined;

  type Props = {
    workspaces: WorkspaceRow[];
    zenIcons: ZenWorkspaceIconRow[];
    onselect?: (kind: IconKind, value: string) => void | Promise<void>;
  };

  const pages = WORKSPACE_ICON_PAGES;

  let { workspaces, zenIcons, onselect }: Props = $props();
  let page = $state<IconKind>("emoji");
  let query = $state("");
  let highlightedIndex = $state(0);
  let activeSection = $state<"search" | "pages" | "grid">("search");
  let searchInput: HTMLInputElement | null = $state(null);
  let grid: HTMLDivElement | null = $state(null);

  const activeWorkspace = $derived(workspaces.find((workspace) => workspace.isActive) ?? workspaces[0] ?? null);
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const choices = $derived(buildChoices(page));
  const visibleChoices = $derived(choices.filter(matchesQuery));
  const selectedValue = $derived(selectedValueForPage(activeWorkspace, page));

  function buildChoices(kind: IconKind): IconChoice[] {
    if (kind === "emoji") {
      return WORKSPACE_EMOJIS.map((item) => ({
        kind,
        value: item.emoji,
        label: item.label,
        terms: item.terms,
        emoji: item.emoji,
      }));
    }
    if (kind === "zen") {
      return zenIcons.map((item) => ({
        kind,
        value: item.name,
        label: item.label,
        terms: [item.name.replace(/\.svg$/, "").replace(/-/g, " ")],
        svgContent: item.svgContent,
      }));
    }
    return LUCIDE_ICONS.map((item) => ({
      kind,
      value: item.name,
      label: item.label,
      terms: item.terms,
      src: iconUrl(item.name),
    }));
  }

  function selectedValueForPage(workspace: WorkspaceRow | null, kind: IconKind) {
    if (!workspace) return null;
    if (kind === "emoji") return workspace.emojiIcon ?? null;
    if (kind === "zen") return workspace.zenIconName ?? null;
    return workspace.lucideIconName ?? null;
  }

  function iconUrl(name: string) {
    const runtime = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
    return runtime?.runtime.getURL(`lucide-icons/${name}.svg`) ?? `../lucide-icons/${name}.svg`;
  }

  function matchesQuery(choice: IconChoice) {
    if (!normalizedQuery) return true;
    const haystack = `${choice.value} ${choice.label} ${choice.terms.join(" ")}`.toLowerCase();
    return normalizedQuery.split(/\s+/).every((term) => haystack.includes(term));
  }

  function clearQuery() {
    query = "";
    highlightedIndex = 0;
    activeSection = "search";
    void tick().then(() => searchInput?.focus());
  }

  function setPage(kind: IconKind, focusGrid = false, focusTab = false) {
    page = kind;
    highlightedIndex = 0;
    void tick().then(() => {
      if (focusGrid) focusChoice(0);
      else if (focusTab) document.querySelector<HTMLElement>(".workspace-icon-pages button.active")?.focus();
    });
  }

  function choiceColumns() {
    const first = grid?.querySelector<HTMLElement>(".workspace-icon-choice");
    if (!grid || !first) return 1;
    const width = first.offsetWidth || 86;
    return Math.max(1, Math.floor(grid.clientWidth / Math.max(1, width)));
  }

  function clampIndex(index: number) {
    if (!visibleChoices.length) return -1;
    return Math.max(0, Math.min(index, visibleChoices.length - 1));
  }

  async function focusChoice(index: number) {
    const next = clampIndex(index);
    if (next < 0) return;
    highlightedIndex = next;
    activeSection = "grid";
    await tick();
    const el = grid?.querySelector<HTMLElement>(`[data-choice-index="${next}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function activateChoice(choice = visibleChoices[highlightedIndex]) {
    if (!choice) return;
    onselect?.(choice.kind, choice.value);
  }

  function switchPageForKey(event: KeyboardEvent) {
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const index = /^[1-3]$/.test(event.key) ? Number(event.key) - 1 : -1;
    const pageMatch = pages[index];
    if (pageMatch) {
      event.preventDefault();
      event.stopPropagation();
      setPage(pageMatch.kind, true);
      return true;
    }
    return false;
  }

  function focusActivePageTab() {
    activeSection = "pages";
    void tick().then(() => {
      document.querySelector<HTMLElement>(".workspace-icon-pages button.active")?.focus();
    });
  }

  function focusSearch() {
    activeSection = "search";
    void tick().then(() => searchInput?.focus());
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (switchPageForKey(event)) return;
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) void focusChoice(highlightedIndex);
      else focusActivePageTab();
      return;
    }
    if (event.key === "Escape") return;
    event.stopPropagation();
  }

  function handleModeKeydown(event: KeyboardEvent, kind: IconKind) {
    if (switchPageForKey(event)) return;
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) focusSearch();
      else void focusChoice(highlightedIndex);
      return;
    }
    const currentIndex = pages.findIndex((item) => item.kind === page);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setPage(pages[(currentIndex + 1) % pages.length].kind, false, true);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setPage(pages[(currentIndex - 1 + pages.length) % pages.length].kind, false, true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      setPage(kind, true);
    }
  }

  function handleChoiceKeydown(event: KeyboardEvent) {
    if (switchPageForKey(event)) return;
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) focusActivePageTab();
      else focusSearch();
      return;
    }
    const columns = choiceColumns();
    let next: number | null = null;
    if (event.key === "ArrowRight") next = highlightedIndex + 1;
    else if (event.key === "ArrowLeft") next = highlightedIndex - 1;
    else if (event.key === "ArrowDown") next = highlightedIndex + columns;
    else if (event.key === "ArrowUp") next = highlightedIndex - columns;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = visibleChoices.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      activateChoice();
      return;
    } else if (event.key === "Escape" || event.key === "Backspace") {
      return;
    }

    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      void focusChoice(next);
    }
  }

  $effect(() => {
    normalizedQuery;
    page;
    if (highlightedIndex >= visibleChoices.length) {
      highlightedIndex = Math.max(0, visibleChoices.length - 1);
    }
  });

  $effect(() => {
    void tick().then(() => searchInput?.focus());
  });
</script>

<div class="workspace-icon-picker">
  <div class="workspace-icon-header">
    <div class="workspace-icon-toolbar">
      <div class="workspace-icon-target">
        {#if activeWorkspace?.svgContent}
          <span class="workspace-icon-target-glyph">{@html activeWorkspace.svgContent}</span>
        {:else if activeWorkspace?.emojiIcon}
          <span class="workspace-icon-target-emoji">{activeWorkspace.emojiIcon}</span>
        {/if}
        <span class="workspace-icon-target-name">{activeWorkspace?.name ?? "Workspace"}</span>
      </div>
      <div class="workspace-icon-search-wrap">
        <input
          bind:this={searchInput}
          class="workspace-icon-search"
          type="search"
          placeholder="Search icons"
          bind:value={query}
          onfocus={() => { activeSection = "search"; }}
          onkeydown={handleSearchKeydown}
        />
        {#if query}
          <button type="button" class="workspace-icon-clear" aria-label="Clear search" tabindex="-1" onclick={clearQuery}>×</button>
        {/if}
      </div>
    </div>
    <div class="workspace-icon-pages" role="tablist" aria-label="Icon type">
      {#each pages as item}
        <button
          type="button"
          class:active={page === item.kind}
          class:section-active={activeSection === "pages" && page === item.kind}
          role="tab"
          aria-selected={page === item.kind}
          tabindex={page === item.kind ? 0 : -1}
          onclick={() => setPage(item.kind)}
          onfocus={() => { activeSection = "pages"; }}
          onkeydown={(event) => handleModeKeydown(event, item.kind)}
        >
          <span>{item.label}</span>
          <Badge value={item.shortcut} />
        </button>
      {/each}
    </div>
  </div>

  <div class="workspace-icon-grid" bind:this={grid} aria-label={`${page} icons`}>
    {#if visibleChoices.length === 0}
      <div class="empty-state">No icons found</div>
    {:else}
      {#each visibleChoices as icon, index (`${icon.kind}:${icon.value}`)}
        <button
          type="button"
          class="workspace-icon-choice"
          class:selected={selectedValue === icon.value}
          class:highlighted={highlightedIndex === index}
          class:section-active={activeSection === "grid" && highlightedIndex === index}
          title={icon.label}
          aria-label={icon.label}
          tabindex={highlightedIndex === index ? 0 : -1}
          data-choice-index={index}
          onfocus={() => { highlightedIndex = index; activeSection = "grid"; }}
          onclick={() => activateChoice(icon)}
          onkeydown={handleChoiceKeydown}
        >
          {#if icon.emoji}
            <span class="workspace-icon-emoji">{icon.emoji}</span>
          {:else if icon.svgContent}
            <span class="workspace-icon-svg">{@html icon.svgContent}</span>
          {:else if icon.src}
            <img src={icon.src} alt="" loading="lazy" />
          {/if}
          <span class="workspace-icon-label">
            <span>{icon.label}</span>
            {#if selectedValue === icon.value}
              <span class="workspace-icon-current">Current</span>
            {/if}
          </span>
        </button>
      {/each}
    {/if}
  </div>
</div>
