<script lang="ts">
  let { value }: { value: string | null | undefined } = $props();
</script>

<span
  class={`item-badge${value && String(value).length > 1 ? " badge-wide" : ""}`}
  hidden={!value}
>{value ? String(value) : ""}</span>
