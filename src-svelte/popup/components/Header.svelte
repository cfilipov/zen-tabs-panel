<script lang="ts">
  type Props = {
    hidden?: boolean;
    title?: string;
    hint?: string | null;
    onback?: () => void;
  };

  let { hidden = false, title = "", hint = null, onback }: Props = $props();

  function handleBackKey(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onback?.();
  }
</script>

<div id="header" class:hidden>
  <span
    id="back-button"
    role="button"
    aria-label="Back"
    class:hidden={hidden || !onback}
    tabindex="-1"
    onclick={() => onback?.()}
    onkeydown={handleBackKey}
  >&#8592;</span>
  <span id="view-title">{title}</span>
  <span id="header-hint" class:hidden={!hint}>{hint ?? ""}</span>
</div>
