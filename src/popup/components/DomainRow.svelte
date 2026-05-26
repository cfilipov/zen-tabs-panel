<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { DomainIndexRow } from "../runtime/tab-index-client";

  type Props = {
    row: DomainIndexRow;
    index?: number;
    badge?: string | null;
    selectedDomain?: string | null;
    onactivate?: (index: number) => void;
    onclose?: (row: DomainIndexRow) => void;
  };

  let { row, index = -1, badge = null, selectedDomain = null, onactivate, onclose }: Props = $props();
  const selected = $derived(row.domain === selectedDomain);

  function closeRow(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    onclose?.(row);
  }
</script>

<button
  type="button"
  class="list-item"
  class:selected
  data-domain={row.domain}
  onclick={() => onactivate?.(index)}
>
  <span class="item-icon-placeholder">○</span>
  <span class="item-text">
    <span class="item-title">{row.domain}</span>
  </span>
  <span class="item-right">
    <span class="item-count">{row.count}</span>
    <span class="item-badge-stack">
      <Badge value={badge} />
      <span
        role="button"
        tabindex="-1"
        class="item-close"
        title="Close domain tabs"
        onkeydown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          closeRow(event);
        }}
        onclick={closeRow}
      >✕</span>
    </span>
    <span class="item-arrow">›</span>
  </span>
</button>
