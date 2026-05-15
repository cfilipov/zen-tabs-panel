<script lang="ts">
  import Header from "./Header.svelte";

  type Props = {
    children?: import("svelte").Snippet;
    headerHidden?: boolean;
    title?: string;
    hint?: string | null;
    onback?: () => void;
  };

  let { children, headerHidden = false, title = "", hint = null, onback }: Props = $props();
</script>

<div id="palette">
  <Header hidden={headerHidden} {title} {hint} {onback} />
  <div id="content">
    <div id="list">
      {@render children?.()}
    </div>
    <div id="sidebar" class="hidden"></div>
  </div>
  <div id="page-indicator" class="hidden"></div>
</div>
