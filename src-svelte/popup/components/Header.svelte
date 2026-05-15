<script lang="ts">
  type Props = {
    hidden?: boolean;
  };

  let { hidden = false }: Props = $props();
</script>

<div id="header" class:hidden>
  <span id="back-button" class="hidden" tabindex="-1">&#8592;</span>
  <span id="view-title"></span>
  <span id="header-hint" class="hidden"></span>
</div>
