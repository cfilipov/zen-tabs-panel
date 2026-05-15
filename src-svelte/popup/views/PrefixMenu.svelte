<script lang="ts">
  import ActionRow from "../components/ActionRow.svelte";
  import type { ActionMenuItem } from "./actions-model";
  import type { ViewId } from "../../shared/types";

  type Props = {
    view: ViewId;
    items: ActionMenuItem[];
    selectedId?: string | null;
    onactivate?: (item: ActionMenuItem) => void;
  };

  let { view, items, selectedId = null, onactivate }: Props = $props();
  const twoColumn = $derived(view === "reorder-tabs" || view === "close-and-select");
</script>

{#if twoColumn}
  <div class="actions-grid actions-grid-2col">
    {#each items as item (item.id)}
      <ActionRow {item} compact selected={item.id === selectedId} onactivate={onactivate} />
    {/each}
  </div>
{:else}
  {#each items as item (item.id)}
    <ActionRow {item} selected={item.id === selectedId} onactivate={onactivate} />
  {/each}
{/if}
