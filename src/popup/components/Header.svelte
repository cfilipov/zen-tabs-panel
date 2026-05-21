<script lang="ts">
  type Props = {
    hidden?: boolean;
    title?: string;
    hint?: string | null;
    hintTone?: "normal" | "error";
    overlay?: boolean;
    onback?: () => void;
  };

  let { hidden = false, title = "", hint = null, hintTone = "normal", overlay = false, onback }: Props = $props();

  function handleBackKey(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onback?.();
  }
</script>

<div id="header" class:hidden class:overlay>
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
  <span id="header-hint" class:hidden={!hint} class:error={hintTone === "error"}>{hint ?? ""}</span>
</div>
