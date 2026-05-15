<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { ActionMenuItem } from "../views/actions-model";

  type Props = {
    item: ActionMenuItem;
    compact?: boolean;
    selected?: boolean;
    onactivate?: (item: ActionMenuItem) => void;
  };

  let { item, compact = false, selected = false, onactivate }: Props = $props();
</script>

<button
  type="button"
  class="list-item"
  class:compact-item={compact}
  class:disabled={item.disabled}
  class:selected
  data-id={item.id}
  disabled={item.disabled}
  onclick={() => onactivate?.(item)}
>
  <span class="item-icon-placeholder">{item.icon ?? ""}</span>
  <span class="item-text">
    <span class="item-title">{item.label}</span>
  </span>
  <span class="item-right">
    <Badge value={item.badge} />
    <span class="item-arrow">{item.isView ? "›" : ""}</span>
  </span>
</button>
