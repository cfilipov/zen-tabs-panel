<script lang="ts">
  import Badge from "../components/Badge.svelte";
  import { iconHtml } from "../components/icons";
  import {
    DUPLICATE_PROMPT_OPTIONS,
    type DuplicatePromptAction,
    type DuplicatePromptOption,
  } from "../interaction/duplicate-prompt-options";

  type Props = {
    url: string;
    existingDomId?: string | null;
    selectedIndex?: number;
    onactivate?: (action: DuplicatePromptAction) => void;
    onpreview?: (domId: string) => void;
    onclearpreview?: () => void;
  };

  let { url, existingDomId = null, selectedIndex = 0, onactivate, onpreview, onclearpreview }: Props = $props();

  const options = $derived<(DuplicatePromptOption & { domId?: string | null })[]>(
    DUPLICATE_PROMPT_OPTIONS.map((option, index) => ({
      ...option,
      domId: index === 0 ? existingDomId : null,
    })),
  );
</script>

<div class="duplicate-prompt-url">{url}</div>
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
