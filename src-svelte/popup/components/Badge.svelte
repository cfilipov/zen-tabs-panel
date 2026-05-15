<script lang="ts">
  let { value }: { value: string | null | undefined } = $props();
  const isWide = $derived(Boolean(value && value.length > 1));
</script>

{#if value}
  <span class:item-badge={true} class:badge-wide={isWide}>{value}</span>
{/if}
