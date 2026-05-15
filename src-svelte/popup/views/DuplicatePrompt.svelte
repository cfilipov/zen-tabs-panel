<script lang="ts">
  import Badge from "../components/Badge.svelte";
  import { iconHtml } from "../components/icons";

  export type DuplicatePromptAction = "duplicate-switch" | "duplicate-open-anyway" | "hide-palette";

  type PromptOption = {
    label: string;
    hotkey: string;
    action: DuplicatePromptAction;
    icon: string;
    domId?: string | null;
  };

  type Props = {
    url: string;
    existingDomId?: string | null;
    selectedIndex?: number;
    onactivate?: (action: DuplicatePromptAction) => void;
    onpreview?: (domId: string) => void;
    onclearpreview?: () => void;
  };

  let { url, existingDomId = null, selectedIndex = 0, onactivate, onpreview, onclearpreview }: Props = $props();

  const options = $derived<PromptOption[]>([
    { label: "Switch to existing tab", hotkey: "S", action: "duplicate-switch", icon: "svg:arrow-right", domId: existingDomId },
    { label: "Open anyway", hotkey: "O", action: "duplicate-open-anyway", icon: "svg:plus" },
    { label: "Cancel", hotkey: "C", action: "hide-palette", icon: "svg:x-circle" },
  ]);
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
