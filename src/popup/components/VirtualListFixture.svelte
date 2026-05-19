<script lang="ts">
  import VirtualList from "./VirtualList.svelte";

  type Props = {
    rows: string[];
    total: number;
    offset?: number;
    rowHeight?: number;
  };

  let { rows, total, offset = 0, rowHeight = 40 }: Props = $props();
</script>

<VirtualList {rows} {total} {offset} {rowHeight}>
  {#snippet children(row: string)}
    <div data-testid="row">{row}</div>
  {/snippet}
</VirtualList>
