<script lang="ts" generics="T">
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";

  type Props = {
    rows: T[];
    total: number;
    offset?: number;
    rowHeight?: number;
    overscan?: number;
    onrange?: (offset: number, limit: number) => void;
    children: Snippet<[T, number]>;
  };

  let { rows, total, offset = 0, rowHeight = 40, overscan = 8, onrange, children }: Props = $props();

  let host: HTMLDivElement;
  let lastRequested = "";

  function getScroller() {
    return host?.parentElement;
  }

  function requestVisibleRange() {
    const scroller = getScroller();
    if (!scroller || total <= 0) return;

    const visibleRows = Math.max(1, Math.ceil(scroller.clientHeight / rowHeight));
    const start = Math.max(0, Math.floor(scroller.scrollTop / rowHeight) - overscan);
    const limit = Math.min(200, visibleRows + overscan * 2);
    const loadedStart = offset;
    const loadedEnd = offset + rows.length;
    const neededEnd = Math.min(total, start + limit);

    if (start >= loadedStart && neededEnd <= loadedEnd) {
      return;
    }

    const key = `${start}:${limit}`;
    if (key === lastRequested) {
      return;
    }
    lastRequested = key;
    onrange?.(start, limit);
  }

  onMount(() => {
    const scroller = getScroller();
    if (!scroller) return;

    requestVisibleRange();
    scroller.addEventListener("scroll", requestVisibleRange, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(requestVisibleRange);
    resizeObserver?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", requestVisibleRange);
      resizeObserver?.disconnect();
    };
  });

  $effect(() => {
    total;
    rowHeight;
    rows.length;
    offset;
    requestAnimationFrame(requestVisibleRange);
  });
</script>

<div
  bind:this={host}
  class="virtual-list"
  style={`--ztp-row-height:${rowHeight}px; height:${Math.max(0, total * rowHeight)}px`}
  data-total={total}
  data-offset={offset}
>
  <div class="virtual-list-window" style={`transform: translateY(${offset * rowHeight}px)`}>
    {#each rows as row, index}
      {@render children(row, index)}
    {/each}
  </div>
</div>
