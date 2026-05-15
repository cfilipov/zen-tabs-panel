<script lang="ts">
  import Header from "./Header.svelte";

  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div id="palette">
  <Header />
  <div id="content">
    <div id="list">
      {@render children?.()}
    </div>
    <div id="sidebar" class="hidden"></div>
  </div>
  <div id="page-indicator" class="hidden"></div>
</div>
