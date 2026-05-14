<script lang="ts">
  import { onMount } from "svelte";
  import "./popup.css";

  const legacyScripts = [
    "../shared/constants.js",
    "../shared/dom-utils.js",
    "../shared/messaging.js",
    "../shared/keybindings.js",
    "../shared/chord-engine.js",
    "state.js",
    "render.js",
    "keyboard.js",
    "views/workspaces.js",
    "views/actions.js",
    "views/tabs.js",
    "views/history.js",
    "views/info.js",
    "views/domains.js",
    "views/age.js",
    "views/menus.js",
    "popup.js",
  ];

  let bootError = $state<string | null>(null);

  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      for (const src of legacyScripts) {
        if (cancelled) return;
        await loadScript(src);
      }
    })().catch((error) => {
      bootError = error instanceof Error ? error.message : String(error);
    });

    return () => {
      cancelled = true;
    };
  });
</script>

<div id="palette">
  <div id="header">
    <span id="back-button" class="hidden" tabindex="-1">&#8592;</span>
    <span id="view-title"></span>
    <span id="header-hint" class="hidden"></span>
  </div>
  <div id="content">
    <div id="list">
      {#if bootError}
        <div class="empty-state">{bootError}</div>
      {/if}
    </div>
    <div id="sidebar" class="hidden"></div>
  </div>
  <div id="page-indicator" class="hidden"></div>
</div>
