<script lang="ts">
  let { value }: { value: string | null | undefined } = $props();
  const label = $derived(value ? String(value) : "");
  const parts = $derived(label.trim().split(/\s+/).filter(Boolean));
</script>

{#if parts.length > 1}
  <span class="item-badge-sequence" aria-label={label}>
    {#each parts as part}
      <span class={`item-badge${part.length > 1 ? " badge-wide" : ""}`}>{part}</span>
    {/each}
  </span>
{:else}
  <span
    class={`item-badge${label.length > 1 ? " badge-wide" : ""}`}
    hidden={!label}
  >{label}</span>
{/if}
