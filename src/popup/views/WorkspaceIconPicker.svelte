<script lang="ts">
  import { tick } from "svelte";
  import { LUCIDE_ICONS } from "../generated/lucide-icons";
  import type { WorkspaceRow } from "../runtime/workspace-client";

  type RuntimeLike = {
    runtime: {
      getURL(path: string): string;
    };
  };

  declare const browser: RuntimeLike | undefined;
  declare const chrome: RuntimeLike | undefined;

  type Props = {
    workspaces: WorkspaceRow[];
    onselect?: (iconName: string) => void | Promise<void>;
  };

  let { workspaces, onselect }: Props = $props();
  let query = $state("");
  let searchInput: HTMLInputElement | null = $state(null);

  const activeWorkspace = $derived(workspaces.find((workspace) => workspace.isActive) ?? workspaces[0] ?? null);
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const visibleIcons = $derived(LUCIDE_ICONS.filter((icon) => {
    if (!normalizedQuery) return true;
    const haystack = `${icon.name} ${icon.label} ${icon.terms.join(" ")}`.toLowerCase();
    return normalizedQuery.split(/\s+/).every((term) => haystack.includes(term));
  }));

  function iconUrl(name: string) {
    const runtime = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
    return runtime?.runtime.getURL(`lucide-icons/${name}.svg`) ?? `../lucide-icons/${name}.svg`;
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") return;
    event.stopPropagation();
  }

  function handleChoiceKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" || event.key === "Backspace") return;
    event.stopPropagation();
  }

  $effect(() => {
    void tick().then(() => searchInput?.focus());
  });
</script>

<div class="workspace-icon-picker">
  <div class="workspace-icon-toolbar">
    <div class="workspace-icon-target">
      {#if activeWorkspace?.svgContent}
        <span class="workspace-icon-target-glyph">{@html activeWorkspace.svgContent}</span>
      {/if}
      <span class="workspace-icon-target-name">{activeWorkspace?.name ?? "Workspace"}</span>
    </div>
    <input
      bind:this={searchInput}
      class="workspace-icon-search"
      type="search"
      placeholder="Search icons"
      bind:value={query}
      onkeydown={handleSearchKeydown}
    />
  </div>

  <div class="workspace-icon-grid" aria-label="Workspace icons">
    {#each visibleIcons as icon (icon.name)}
      <button
        type="button"
        class="workspace-icon-choice"
        class:selected={activeWorkspace?.lucideIconName === icon.name}
        title={icon.label}
        aria-label={icon.label}
        onclick={() => onselect?.(icon.name)}
        onkeydown={handleChoiceKeydown}
      >
        <img src={iconUrl(icon.name)} alt="" loading="lazy" />
        <span>{icon.label}</span>
      </button>
    {/each}
  </div>
</div>
