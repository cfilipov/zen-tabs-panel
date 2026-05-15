<script lang="ts">
  import { onMount } from "svelte";
  import PaletteShell from "./components/PaletteShell.svelte";
  import ActionsMenu from "./views/ActionsMenu.svelte";
  import { buildActionsMenuModel, type ActionMenuItem } from "./views/actions-model";
  import { fireMessage } from "./runtime/ipc";
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
  const nativeMode = new URLSearchParams(location.search).get("native") === "1";
  const actionSections = buildActionsMenuModel();

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
    if (nativeMode) return;
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

  function activateNativeAction(item: ActionMenuItem) {
    if (item.kind === "action") {
      fireMessage({ type: item.id });
      return;
    }

    if (item.view) {
      bootError = `${item.label} is still handled by the compatibility runtime`;
    }
  }
</script>

<PaletteShell>
  {#if nativeMode}
    <ActionsMenu sections={actionSections} onactivate={activateNativeAction} />
  {:else if bootError}
    <div class="empty-state">{bootError}</div>
  {/if}
</PaletteShell>
