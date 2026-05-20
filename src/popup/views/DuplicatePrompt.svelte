<script lang="ts">
  import Badge from "../components/Badge.svelte";
  import { iconHtml } from "../components/icons";
  import {
    DUPLICATE_PROMPT_OPTIONS,
    type DuplicatePromptAction,
    type DuplicatePromptOption,
  } from "../interaction/duplicate-prompt-options";
  import type { DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";
  import DuplicateGroupSection from "./DuplicateGroupSection.svelte";

  type Props = {
    url: string;
    existingDomId?: string | null;
    group?: DuplicateGroupRow | null;
    workspaces?: WorkspaceRow[];
    selectedIndex?: number;
    onactivate?: (action: DuplicatePromptAction) => void;
    ontabactivate?: (row: TabIndexRow) => void;
    onclose?: (row: TabIndexRow) => void;
    onpreview?: (domId: string) => void;
    onclearpreview?: () => void;
  };

  let {
    url,
    existingDomId = null,
    group = null,
    workspaces = [],
    selectedIndex = 0,
    onactivate,
    ontabactivate,
    onclose,
    onpreview,
    onclearpreview,
  }: Props = $props();

  const options = $derived<(DuplicatePromptOption & { domId?: string | null })[]>(
    DUPLICATE_PROMPT_OPTIONS.map((option, index) => ({
      ...option,
      domId: index === 0 ? existingDomId : null,
    })),
  );
  const selectedDuplicateIndex = $derived(selectedIndex >= options.length ? selectedIndex - options.length : -1);
</script>

{#each options as option, index (option.action)}
  <button
    type="button"
    class="list-item"
    class:selected={index === selectedIndex}
    data-dom-id={option.domId || undefined}
    onmouseenter={() => {
      if (option.domId) onpreview?.(option.domId);
    }}
    onmouseleave={() => onclearpreview?.()}
    onclick={() => onactivate?.(option.action)}
  >
    <span class="item-icon-placeholder">{@html iconHtml(option.icon)}</span>
    <span class="item-text">
      <span class="item-title">{option.label}</span>
    </span>
    <span class="item-right"><Badge value={option.hotkey} /></span>
  </button>
{/each}

{#if group}
  <div class="duplicate-prompt-divider"></div>
  <div class="duplicate-prompt-group">
    <DuplicateGroupSection
      {group}
      {workspaces}
      title={url || group.url}
      limit={9}
      selectedIndex={selectedDuplicateIndex}
      shortcutForIndex={(index) => String(index + 1)}
      onactivate={ontabactivate}
      {onclose}
      onpreview={(tab) => onpreview?.(tab.domId)}
      {onclearpreview}
    />
  </div>
{/if}
