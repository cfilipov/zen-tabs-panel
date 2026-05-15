<script lang="ts">
  import Badge from "./Badge.svelte";
  import type { DomainIndexRow } from "../runtime/tab-index-client";

  type Props = {
    row: DomainIndexRow;
    badge?: string | null;
    selected?: boolean;
    onactivate?: (row: DomainIndexRow) => void;
  };

  let { row, badge = null, selected = false, onactivate }: Props = $props();
</script>

<button
  type="button"
  class="list-item"
  class:selected
  data-domain={row.domain}
  onclick={() => onactivate?.(row)}
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
