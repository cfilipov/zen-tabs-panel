<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { DomainIndexRow } from "../runtime/tab-index-client";

  type Props = {
    row: DomainIndexRow;
    index?: number;
    badge?: string | null;
    selectedDomain?: string | null;
    onactivate?: (index: number) => void;
  };

  let { row, index = -1, badge = null, selectedDomain = null, onactivate }: Props = $props();
  const selected = $derived(row.domain === selectedDomain);
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
    <Badge value={badge} />
    <span class="item-arrow">›</span>
  </span>
</button>
