<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { ExtensionRow } from "../runtime/extension-client";

  type Props = {
    extensions?: ExtensionRow[];
    onactivate?: (extension: ExtensionRow) => void;
  };

  let { extensions = [], onactivate }: Props = $props();
</script>

{#if extensions.length > 0}
  <div class="extensions-strip">
    {#each extensions as extension, index (extension.id)}
      <button
        type="button"
        class="extension-icon-button"
        title={extension.name}
        data-extension-id={extension.id}
        onclick={() => onactivate?.(extension)}
      >
        <span class="extension-icon-wrap">
          {#if extension.iconDataUrl}
            <img class="extension-icon" src={extension.iconDataUrl} alt="" />
          {:else}
            <span class="extension-icon-fallback">{extension.name.slice(0, 1).toUpperCase()}</span>
          {/if}
          {#if extension.actionBadge?.text}
            <span
              class="extension-action-badge"
              style:background-color={extension.actionBadge.backgroundColor}
              style:color={extension.actionBadge.color}
            >{extension.actionBadge.text}</span>
          {/if}
        </span>
        <Badge value={index < 9 ? `⇧${index + 1}` : null} />
      </button>
    {/each}
  </div>
{/if}
