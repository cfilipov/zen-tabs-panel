<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  type Props = {
    rows: T[];
    total: number;
    rowHeight?: number;
    overscan?: number;
    children: Snippet<[T, number]>;
  };

  let { rows, total, rowHeight = 40, children }: Props = $props();
</script>

<div class="virtual-list" style={`--ztp-row-height:${rowHeight}px`} data-total={total}>
  {#each rows as row, index}
    {@render children(row, index)}
  {/each}
</div>
