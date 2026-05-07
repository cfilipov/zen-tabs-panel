/* globals ExtensionAPI, Services */
"use strict";

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { EventManager } = ExtensionCommon;

this.zenWorkspaces = class extends ExtensionAPI {
  getAPI(context) {

    // -----------------------------------------------------------------------
    // Companion Zen Mods
    // -----------------------------------------------------------------------

    const COMPANION_MODS = {
      "zen-tabs-panel-unread-indicator": {
        name: "Unread Tab Indicator",
        description: "Blue dot on tabs opened in the background that you haven't visited yet.",
        version: "1.0.0",
        css: `
.tabbrowser-tab[unread="true"] .tab-content {
  position: relative !important;
}
.tabbrowser-tab[unread="true"] .tab-content::after {
  content: "" !important;
  position: absolute !important;
  top: 50% !important;
  right: 8px !important;
  transform: translateY(-50%) !important;
  width: 8px !important;
  height: 8px !important;
  border-radius: 50% !important;
  background: #3b82f6 !important;
  border: 1.5px solid rgba(0, 0, 0, 0.3) !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
  z-index: 9999 !important;
  pointer-events: none !important;
}
.tabbrowser-tab[unread="true"] .tab-label-container {
  margin-right: 22px !important;
}
.tabbrowser-tab[unread="true"]:hover .tab-content::after {
  display: none !important;
}`,
      },
      "zen-tabs-panel-dim-unloaded": {
        name: "Dim Unloaded Tabs",
        description: "Grayscale and fade tabs that have been unloaded from memory.",
        version: "1.0.0",
        css: `
.tabbrowser-tab[pending="true"] .tab-icon-stack {
  filter: grayscale(1) !important;
  opacity: 0.5 !important;
}
.tabbrowser-tab[pending="true"] .tab-label-container {
  filter: grayscale(1) !important;
  opacity: 0.5 !important;
}`,
      },
      "zen-tabs-panel-corner-fix": {
        name: "Corner Bleed Fix",
        description: "Fixes white corners bleeding through rounded edges using clip-path. Trades corner bleed for slightly blurry text on large or high-DPI displays — a Gecko compositor limitation with no perfect CSS fix (see zen-browser/desktop#8421).",
        version: "1.0.4",
        css: `
.browserStack,
.browserStack > browser {
  clip-path: inset(0 round var(--zen-native-inner-radius)) !important;
}`,
      },
      "zen-tabs-panel-split-header-hover": {
        name: "Split View Header on Hover",
        description: "Hides the split view toolbar until you hover near the top edge of the pane.",
        version: "1.0.0",
        css: `
.browserSidebarContainer .zen-view-splitter-header-container {
  opacity: 0 !important;
  transition: opacity 0.15s !important;
}
.zen-view-splitter-header-container:hover {
  opacity: 1 !important;
}`,
      },
    };

    // Clean up on extension unload
    context.callOnClose({
      close() {
        try { disarmChord(); } catch (e) {}
        try { uninstallGestureListener(); } catch (e) {}
        const w = Services.wm.getMostRecentWindow("navigator:browser");
        if (!w) return;
        const overlay = w.document.getElementById("zen-tabs-panel-overlay");
        if (overlay) overlay.remove();
      },
    });

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function getWin() {
      return Services.wm.getMostRecentWindow("navigator:browser");
    }

    function findTabByDomId(domId) {
      const w = getWin();
      if (!w) return null;
      return w.document.getElementById(domId);
    }

    function getExtTabId(nativeTab) {
      try {
        return context.extension.tabManager.getWrapper(nativeTab)?.id ?? null;
      } catch (e) {
        return null;
      }
    }

    function unwrapFavicon(url) {
      if (!url) return "";
      if (url.startsWith("moz-remote-image://")) {
        try {
          const parsed = new URL(url);
          return parsed.searchParams.get("url") || url;
        } catch (e) {}
      }
      return url;
    }

    // Get all tab elements across all workspaces from the DOM
    function getAllTabElements() {
      const w = getWin();
      if (!w || !w.document) return [];
      return Array.from(w.document.querySelectorAll(".tabbrowser-tab"));
    }

    async function changeWorkspaceByOffset(offset) {
      const w = getWin();
      if (!w?.gZenWorkspaces) return false;
      const list = w.gZenWorkspaces.getWorkspaces();
      if (!Array.isArray(list) || list.length < 2) return false;
      const active = w.gZenWorkspaces.getActiveWorkspace();
      if (!active) return false;
      const idx = list.findIndex((ws) => ws.uuid === active.uuid);
      if (idx < 0) return false;
      const next = list[(idx + offset + list.length) % list.length];
      try { await w.gZenWorkspaces.changeWorkspace(next); return true; }
      catch (e) { return false; }
    }

    const DUP_INDICATOR_CSS = `
        .tabbrowser-tab[zen-tabs-panel-duplicate] .tab-content {
          position: relative !important;
        }
        .tabbrowser-tab[zen-tabs-panel-duplicate] .tab-content::before {
          content: "" !important;
          position: absolute !important;
          top: 50% !important;
          right: 5px !important;
          transform: translateY(-50%) rotate(45deg) !important;
          width: 7px !important;
          height: 7px !important;
          background: #f59e0b !important;
          border: 1.5px solid rgba(0, 0, 0, 0.3) !important;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
          z-index: 9999 !important;
          pointer-events: none !important;
        }
        .tabbrowser-tab[zen-tabs-panel-duplicate][unread="true"] .tab-content::before {
          right: 22px !important;
        }
        .tabbrowser-tab[unread="true"] .tab-content::after {
          right: 8px !important;
        }
        .tabbrowser-tab[unread="true"] .tab-label-container {
          margin-right: 22px !important;
        }
        .tabbrowser-tab[zen-tabs-panel-duplicate]:hover .tab-content::before {
          display: none !important;
        }
        .tabbrowser-tab[zen-tabs-panel-duplicate] .tab-label-container {
          margin-right: 22px !important;
        }
        .tabbrowser-tab[zen-tabs-panel-duplicate][unread="true"] .tab-label-container {
          margin-right: 34px !important;
        }
    `;

    function ensureDuplicateStyles() {
      const w = getWin();
      if (!w) return;
      let el = w.document.getElementById("zen-tabs-panel-dup-indicator-styles");
      if (!el) {
        el = w.document.createElement("style");
        el.id = "zen-tabs-panel-dup-indicator-styles";
        w.document.documentElement.appendChild(el);
      }
      el.textContent = DUP_INDICATOR_CSS;
    }

    function syncDuplicateAttributes() {
      ensureDuplicateStyles();
      const tabs = getAllTabElements();
      const urlCounts = {};
      for (const tab of tabs) {
        const url = tab.linkedBrowser?.currentURI?.spec || "";
        if (url && url !== "about:newtab" && url !== "about:blank") {
          urlCounts[url] = (urlCounts[url] || 0) + 1;
        }
      }
      for (const tab of tabs) {
        const url = tab.linkedBrowser?.currentURI?.spec || "";
        if (urlCounts[url] > 1) {
          tab.setAttribute("zen-tabs-panel-duplicate", "true");
        } else {
          tab.removeAttribute("zen-tabs-panel-duplicate");
        }
      }
    }

    // Activate a native tab, switching workspaces if needed
    async function activateNativeTab(tab) {
      const w = getWin();
      if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;

      const tabWorkspace = tab.getAttribute("zen-workspace-id") || null;
      const activeWorkspace = w.gZenWorkspaces.activeWorkspace;

      if (tabWorkspace && tabWorkspace !== activeWorkspace) {
        await w.gZenWorkspaces.changeWorkspaceWithID(tabWorkspace);
      }

      w.gBrowser.selectedTab = tab;
      return true;
    }

    // -----------------------------------------------------------------------
    // Tab preview highlight
    // -----------------------------------------------------------------------

    let previewedTab = null;
    let savedScrollPositions = null; // Map<scrollbox, scrollTop>
    let restoreRAF = null;

    function applyPreview(tab) {
      if (restoreRAF) {
        const w = getWin();
        if (w) w.cancelAnimationFrame(restoreRAF);
        restoreRAF = null;
      }
      if (previewedTab && previewedTab !== tab) {
        previewedTab.removeAttribute("zen-tabs-panel-preview");
      }
      if (!savedScrollPositions) {
        savedScrollPositions = new Map();
        const w = getWin();
        if (w) {
          for (const asb of w.document.querySelectorAll(".workspace-arrowscrollbox")) {
            if (asb.scrollbox) {
              savedScrollPositions.set(asb.scrollbox, asb.scrollbox.scrollTop);
            }
          }
        }
      }
      tab.setAttribute("zen-tabs-panel-preview", "true");
      previewedTab = tab;
      tab.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    function clearPreviewState() {
      if (previewedTab) {
        previewedTab.removeAttribute("zen-tabs-panel-preview");
        previewedTab = null;
      }
      if (savedScrollPositions) {
        const positions = savedScrollPositions;
        savedScrollPositions = null;
        const restore = () => {
          for (const [scrollbox, scrollTop] of positions) {
            scrollbox.scrollTo({ top: scrollTop, behavior: "instant" });
          }
        };
        restore();
        const w = getWin();
        if (w) {
          restoreRAF = w.requestAnimationFrame(() => {
            restoreRAF = w.requestAnimationFrame(() => {
              restore();
              restoreRAF = null;
            });
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // Palette overlay
    // -----------------------------------------------------------------------

    const OVERLAY_ID = "zen-tabs-panel-overlay";
    const PANEL_ID = "zen-tabs-panel-panel";
    const BROWSER_ID = "zen-tabs-panel-browser";

    const VIEW_SIZES = {
      actions:              { width: 780, height: 604 },
      "child-tabs":         { width: 720, height: 604 },
      "sibling-tabs":       { width: 720, height: 604 },
      "parent-tabs":        { width: 720, height: 604 },
      navigation:           { width: 600, height: 604 },
      "unvisited-tabs":     { width: 720, height: 604 },
      "last-visited":       { width: 720, height: 604 },
      "recently-closed":    { width: 600, height: 604 },
      duplicates:           { width: 720, height: 604 },
      "tab-info":           { width: 600, height: 604 },
      domains:              { width: 720, height: 604 },
      "domain-tabs":        { width: 720, height: 604 },
      "tabs-by-age":        { width: 720, height: 604 },
      "most-visited":       { width: 720, height: 604 },
      "reorder-tabs":       { width: 600, height: 604 },
      "move-to-workspace":  { width: 600, height: 604 },
      "close-and-select":   { width: 600, height: 604 },
    };

    // Chord/leader-key shortcut tree. After the leader (MacCtrl+Cmd+.) fires,
    // a chrome-window-level keydown listener runs the user's next key against
    // this tree. Matched terminals fire actions or open submenus directly,
    // skipping the main palette menu. The tree is built from the shared
    // keybindings registry (shared/keybindings.js) so chord shortcuts and
    // popup menu hotkey badges stay in sync.
    const CHORD_ROOT_TIMEOUT_MS = 400;
    const CHORD_PREFIX_TIMEOUT_MS = 600;

    const kbScope = {};
    Services.scriptloader.loadSubScript(
      context.extension.getURL("shared/keybindings.js"),
      kbScope
    );
    const KEYBINDINGS = kbScope.ZEN_KEYBINDINGS || [];
    const WORKSPACE_DIGIT_CHORDS = kbScope.ZEN_WORKSPACE_DIGIT_CHORDS || [];

    function buildChordNode(entry) {
      if (entry.kind === "action") return { type: "action", actionId: entry.id };
      if (entry.kind === "open-view") return { type: "open-view", view: entry.view };
      if (entry.kind === "prefix") {
        const children = {};
        for (const child of (entry.children || [])) {
          children[child.chord] = buildChordNode(child);
        }
        return {
          type: "prefix",
          timeoutMs: CHORD_PREFIX_TIMEOUT_MS,
          onTimeout: { type: "open-view", view: entry.view },
          children,
        };
      }
      return null;
    }

    const CHORD_TREE = { children: {} };
    for (const entry of KEYBINDINGS) {
      const node = buildChordNode(entry);
      if (node) CHORD_TREE.children[entry.chord] = node;
    }
    for (let i = 0; i < WORKSPACE_DIGIT_CHORDS.length; i++) {
      CHORD_TREE.children[WORKSPACE_DIGIT_CHORDS[i]] = { type: "switch-workspace", index: i };
    }

    let pendingView = null;
    let pendingParams = {};
    let navStack = [];
    let currentViewName = null;
    let morphGeneration = 0;

    // Chord engine state.
    let chordState = null;          // null | "armed-root" | "armed-prefix"
    let chordCurrentNode = null;
    let chordTimer = null;
    let chordKeyListener = null;
    let chordBlurListener = null;
    let chordResolve = null;        // resolver for the showPalette() promise
    let chordPrefixOnTimeout = null;

    function getPaletteURL() {
      const isDark = getWin()?.document?.documentElement?.getAttribute("zen-should-be-dark-mode") === "true";
      let url = context.extension.getURL("popup/popup.html") + "?theme=" + (isDark ? "dark" : "light");
      if (pendingView) url += "&view=" + encodeURIComponent(pendingView);
      if (pendingParams) {
        for (const [k, v] of Object.entries(pendingParams)) {
          url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(v);
        }
      }
      return url;
    }

    function getViewSize(view) {
      return VIEW_SIZES[view] || VIEW_SIZES["actions"];
    }

    function createBrowserElement(w, size) {
      const br = w.document.createXULElement("browser");
      br.id = BROWSER_ID;
      br.setAttribute("type", "content");
      br.setAttribute("remote", "true");
      br.setAttribute("maychangeremoteness", "true");
      br.setAttribute("disableglobalhistory", "true");
      br.setAttribute("messagemanagergroup", "webext-browsers");
      br.setAttribute("webextension-view-type", "popup");
      br.setAttribute("transparent", "true");
      br.setAttribute("src", getPaletteURL());
      br.style.cssText = "width:" + size.width + "px;height:" + size.height + "px;border:none;opacity:1";
      return br;
    }

    function createOverlay() {
      const w = getWin();
      if (!w) return null;

      if (w.document.getElementById(OVERLAY_ID)) return null;

      if (!w.document.getElementById("zen-tabs-panel-anim-styles")) {
        const animStyle = w.document.createElement("style");
        animStyle.id = "zen-tabs-panel-anim-styles";
        animStyle.textContent = `
          @keyframes ztt-overlay-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes ztt-panel-in {
            from { opacity: 0; transform: scale(0.96) translateY(-8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          @keyframes ztt-overlay-out {
            from { opacity: 1; }
            to { opacity: 0; }
          }
          @keyframes ztt-panel-out {
            from { opacity: 1; transform: scale(1) translateY(0); }
            to { opacity: 0; transform: scale(0.96) translateY(-8px); }
          }
        `;
        w.document.documentElement.appendChild(animStyle);
      }

      if (!w.document.getElementById("zen-tabs-panel-preview-styles")) {
        const previewStyle = w.document.createElement("style");
        previewStyle.id = "zen-tabs-panel-preview-styles";
        previewStyle.textContent = `
          .tabbrowser-tab[zen-tabs-panel-preview] .tab-stack {
            outline: 3px solid color-mix(in srgb, var(--zen-primary-color, AccentColor), white 60%) !important;
            outline-offset: -3px;
            border-radius: 10px;
          }
        `;
        w.document.documentElement.appendChild(previewStyle);
      }

      const viewName = pendingView || "actions";
      const size = getViewSize(viewName);

      navStack = [];
      currentViewName = viewName;

      const overlay = w.document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = [
        "position: fixed",
        "top: 0",
        "left: 0",
        "width: 100%",
        "height: 100%",
        "z-index: 99999",
        "display: flex",
        "align-items: center",
        "justify-content: center",
        "background: rgba(0, 0, 0, 0.25)",
        "animation: ztt-overlay-in 0.15s ease-out",
      ].join(";");

      const panel = w.document.createElement("div");
      panel.id = PANEL_ID;
      panel.style.cssText = [
        "width: " + size.width + "px",
        "max-height: " + size.height + "px",
        "background: var(--arrowpanel-background, light-dark(rgb(244, 244, 244), rgb(31, 31, 31)))",
        "border-radius: 12px",
        "border: 1px solid var(--zen-colors-border, light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.08)))",
        "box-shadow: 0 0 9.73px rgba(0, 0, 0, 0.25), 0 24px 60px rgba(0, 0, 0, 0.4)",
        "overflow: hidden",
        "display: flex",
        "flex-direction: column",
        "animation: ztt-panel-in 0.15s ease-out",
        "transition: width 0.15s ease-out, max-height 0.15s ease-out",
      ].join(";");

      const br = createBrowserElement(w, size);
      panel.appendChild(br);
      overlay.appendChild(panel);

      overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) {
          destroyOverlay();
        }
      });

      w.document.documentElement.appendChild(overlay);

      w.setTimeout(() => {
        br.focus();
      }, 50);

      return overlay;
    }

    function morphToView(view, params) {
      const w = getWin();
      if (!w) return;
      const panel = w.document.getElementById(PANEL_ID);
      const oldBrowser = w.document.getElementById(BROWSER_ID);
      if (!panel || !oldBrowser) return;

      const gen = ++morphGeneration;
      const targetSize = getViewSize(view);

      oldBrowser.style.transition = "opacity 0.08s ease-out";
      oldBrowser.style.opacity = "0";

      w.setTimeout(() => {
        if (gen !== morphGeneration) return;

        panel.style.width = targetSize.width + "px";
        panel.style.maxHeight = targetSize.height + "px";

        pendingView = view === "actions" ? null : view;
        pendingParams = params || {};
        const newBr = createBrowserElement(w, targetSize);
        newBr.style.opacity = "0";
        pendingView = null;
        pendingParams = {};

        oldBrowser.remove();
        panel.appendChild(newBr);

        w.setTimeout(() => {
          if (gen !== morphGeneration) return;
          newBr.style.transition = "opacity 0.08s ease-out";
          newBr.style.opacity = "1";
          w.setTimeout(() => {
            if (gen !== morphGeneration) return;
            newBr.focus();
          }, 50);
        }, 160);
      }, 80);
    }

    function destroyOverlay() {
      clearPreviewState();
      const w = getWin();
      if (!w) return;
      const overlay = w.document.getElementById(OVERLAY_ID);
      if (!overlay || overlay.dataset.closing) return;

      overlay.dataset.closing = "true";
      morphGeneration++;
      navStack = [];
      currentViewName = null;

      const panel = w.document.getElementById(PANEL_ID);
      overlay.style.animation = "ztt-overlay-out 0.12s ease-in forwards";
      if (panel) panel.style.animation = "ztt-panel-out 0.12s ease-in forwards";

      overlay.addEventListener("animationend", () => overlay.remove(), { once: true });
    }

    function isOverlayOpen() {
      const w = getWin();
      if (!w) return false;
      const overlay = w.document.getElementById(OVERLAY_ID);
      return overlay && !overlay.dataset.closing;
    }

    // -----------------------------------------------------------------------
    // Chord engine
    // -----------------------------------------------------------------------

    // Map a keydown event to a chord-tree key string, or null if it should be
    // ignored (pure modifier press, or non-Shift modifier held — those fall
    // through to the OS/browser).
    function chordKeyFor(e) {
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") return null;
      if (e.metaKey || e.ctrlKey || e.altKey) return null;
      if (e.key === "Escape") return "Escape";
      if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
        const upper = e.key.toUpperCase();
        return e.shiftKey ? "Shift+" + upper : upper;
      }
      return e.key;
    }

    function disarmChord() {
      const w = getWin();
      if (chordTimer !== null && w) {
        w.clearTimeout(chordTimer);
      }
      if (chordKeyListener && w) {
        w.removeEventListener("keydown", chordKeyListener, true);
      }
      if (chordBlurListener && w) {
        w.removeEventListener("blur", chordBlurListener, true);
      }
      chordTimer = null;
      chordKeyListener = null;
      chordBlurListener = null;
      chordState = null;
      chordCurrentNode = null;
      chordPrefixOnTimeout = null;
    }

    // -----------------------------------------------------------------------
    // Double-tap-Cmd gesture: persistent chrome-window listener that opens
    // the palette when the user taps Cmd-alone twice within DOUBLE_TAP_WINDOW_MS.
    // Replaces the awkward Ctrl+Cmd+. leader for daily use; the manifest
    // keybinding stays as a fallback.
    // -----------------------------------------------------------------------
    const DOUBLE_TAP_WINDOW_MS = 350;
    let cmdAlone = false;
    let lastCmdAloneRelease = 0;
    let gestureListeners = null;
    let paletteRequestFire = null;

    function onGestureKeydown(e) {
      if (e.key === "Meta") {
        cmdAlone = true;
      } else if (e.metaKey) {
        // A non-modifier key pressed while Cmd is held — Cmd is being used
        // as part of a real shortcut, so disqualify this hold from counting
        // as a clean Cmd-alone tap.
        cmdAlone = false;
      }
    }

    function onGestureKeyup(e) {
      if (e.key !== "Meta") return;
      if (cmdAlone) {
        const now = Date.now();
        if (now - lastCmdAloneRelease < DOUBLE_TAP_WINDOW_MS) {
          lastCmdAloneRelease = 0;
          if (paletteRequestFire) paletteRequestFire.async();
        } else {
          lastCmdAloneRelease = now;
        }
      } else {
        lastCmdAloneRelease = 0;
      }
    }

    function onGestureBlur() {
      cmdAlone = false;
      lastCmdAloneRelease = 0;
    }

    function installGestureListener() {
      const w = getWin();
      if (!w || gestureListeners) return;
      gestureListeners = { keydown: onGestureKeydown, keyup: onGestureKeyup, blur: onGestureBlur };
      w.addEventListener("keydown", gestureListeners.keydown, true);
      w.addEventListener("keyup",   gestureListeners.keyup,   true);
      w.addEventListener("blur",    gestureListeners.blur,    true);
    }

    function uninstallGestureListener() {
      const w = getWin();
      if (!w || !gestureListeners) return;
      w.removeEventListener("keydown", gestureListeners.keydown, true);
      w.removeEventListener("keyup",   gestureListeners.keyup,   true);
      w.removeEventListener("blur",    gestureListeners.blur,    true);
      gestureListeners = null;
    }

    function openOverlayWithView(view) {
      pendingView = view || null;
      pendingParams = {};
      createOverlay();
      pendingView = null;
      pendingParams = {};
    }

    function onChordKey(e) {
      const k = chordKeyFor(e);
      // Ignore pure-modifier keydowns and modifier-co-pressed keys: leave them
      // alone so the OS/browser can handle Cmd+P etc. The chord arm still
      // stays live for these — but in practice the leader's modifiers have
      // released by the time the user presses a chord key, so this rarely
      // matters. We don't disarm here either; the chord just continues to
      // wait until a real candidate or timeout.
      if (k === null) return;

      if (k === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const resolve = chordResolve;
        chordResolve = null;
        disarmChord();
        if (resolve) resolve({ kind: "chord-cancelled" });
        return;
      }

      const node = chordCurrentNode?.children?.[k];
      if (!node) {
        // Unknown key: cancel chord silently — no panel.
        e.preventDefault();
        e.stopPropagation();
        const resolve = chordResolve;
        chordResolve = null;
        disarmChord();
        if (resolve) resolve({ kind: "chord-cancelled" });
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (node.type === "action") {
        const resolve = chordResolve;
        chordResolve = null;
        disarmChord();
        if (resolve) resolve({ kind: "chord-action", actionId: node.actionId });
        return;
      }

      if (node.type === "open-view") {
        const resolve = chordResolve;
        chordResolve = null;
        disarmChord();
        openOverlayWithView(node.view);
        if (resolve) resolve({ kind: "opened" });
        return;
      }

      if (node.type === "switch-workspace") {
        const w = getWin();
        const resolve = chordResolve;
        chordResolve = null;
        disarmChord();
        if (w?.gZenWorkspaces) {
          const list = w.gZenWorkspaces.getWorkspaces();
          const ws = Array.isArray(list) ? list[node.index] : null;
          if (ws?.uuid) {
            try { w.gZenWorkspaces.changeWorkspaceWithID(ws.uuid); } catch (err) {}
          }
        }
        if (resolve) resolve({ kind: "chord-cancelled" });
        return;
      }

      if (node.type === "prefix") {
        const w = getWin();
        if (chordTimer !== null && w) w.clearTimeout(chordTimer);
        chordCurrentNode = node;
        chordPrefixOnTimeout = node.onTimeout || null;
        chordState = "armed-prefix";
        chordTimer = w ? w.setTimeout(onChordTimeout, node.timeoutMs ?? CHORD_PREFIX_TIMEOUT_MS) : null;
      }
    }

    function onChordTimeout() {
      const resolve = chordResolve;
      chordResolve = null;
      const onTimeout = chordPrefixOnTimeout;
      disarmChord();

      if (onTimeout && onTimeout.type === "open-view") {
        openOverlayWithView(onTimeout.view);
      } else {
        openOverlayWithView(null); // root timeout → main actions menu
      }
      if (resolve) resolve({ kind: "opened" });
    }

    function onChordBlur() {
      const resolve = chordResolve;
      chordResolve = null;
      disarmChord();
      if (resolve) resolve({ kind: "chord-cancelled" });
    }

    function armChord(resolve) {
      const w = getWin();
      if (!w) {
        resolve({ kind: "chord-cancelled" });
        return;
      }
      chordResolve = resolve;
      chordCurrentNode = CHORD_TREE;
      chordState = "armed-root";
      chordKeyListener = onChordKey;
      chordBlurListener = onChordBlur;
      // Capture-phase keydown on the chrome window catches keys regardless of
      // whether chrome or content has focus, because the chrome window owns
      // the XUL <browser> element wrapping the active tab.
      w.addEventListener("keydown", chordKeyListener, true);
      w.addEventListener("blur", chordBlurListener, true);
      chordTimer = w.setTimeout(onChordTimeout, CHORD_ROOT_TIMEOUT_MS);
    }

    installGestureListener();

    return {
      zenWorkspaces: {
        onPaletteRequest: new EventManager({
          context,
          name: "zenWorkspaces.onPaletteRequest",
          register: (fire) => {
            paletteRequestFire = fire;
            return () => { paletteRequestFire = null; };
          },
        }).api(),

        async getAll() {
          const w = getWin();
          if (!w || !w.gZenWorkspaces) return [];
          return w.gZenWorkspaces.getWorkspaces();
        },

        async getActiveWorkspaceId() {
          const w = getWin();
          if (!w || !w.gZenWorkspaces) return null;
          return w.gZenWorkspaces.activeWorkspace;
        },

        async getTabWorkspaceId(tabId) {
          try {
            const nativeTab = context.extension.tabManager.get(tabId)?.nativeTab;
            if (!nativeTab) return null;
            return nativeTab.getAttribute("zen-workspace-id") || null;
          } catch (e) {
            return null;
          }
        },

        async switchTo(uuid) {
          const w = getWin();
          if (!w || !w.gZenWorkspaces) return;
          await w.gZenWorkspaces.changeWorkspaceWithID(uuid);
        },

        async activateTabByDomId(domId) {
          const tab = findTabByDomId(domId);
          if (!tab) return false;
          return activateNativeTab(tab);
        },

        // Go to previous tab using lastAccessed, filtering out the current
        // tab and any tabs visible in split view.
        async goToPreviousTab() {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;

          const allTabs = getAllTabElements();
          const currentTab = w.gBrowser.selectedTab;
          const currentDomId = currentTab?.id;

          // Collect DOM IDs of tabs currently visible to the user
          const visibleDomIds = new Set();
          if (currentDomId) visibleDomIds.add(currentDomId);

          // If current tab is in a split view, find its sibling tabs
          if (w.gZenViewSplitter?._data) {
            const currentGroup = w.gZenViewSplitter._data.find(
              (g) => g.tabs && g.tabs.some((t) => t.id === currentDomId)
            );
            if (currentGroup) {
              for (const tab of currentGroup.tabs) {
                visibleDomIds.add(tab.id);
              }
            }
          }

          // Sort by lastAccessed descending, filter out visible and unread tabs
          const candidates = allTabs
            .filter((t) => !visibleDomIds.has(t.id) && !t.hasAttribute("unread"))
            .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

          if (candidates.length === 0) return false;

          return activateNativeTab(candidates[0]);
        },

        async goToParentTab() {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;

          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab || !currentTab.openerTab) return false;

          return activateNativeTab(currentTab.openerTab);
        },

        async goToNextSibling() {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab || !currentTab.openerTab) return false;
          const siblings = getAllTabElements().filter((t) => t.openerTab === currentTab.openerTab);
          const idx = siblings.indexOf(currentTab);
          if (idx < 0 || idx === siblings.length - 1) return false;
          return activateNativeTab(siblings[idx + 1]);
        },

        async goToPrevSibling() {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab || !currentTab.openerTab) return false;
          const siblings = getAllTabElements().filter((t) => t.openerTab === currentTab.openerTab);
          const idx = siblings.indexOf(currentTab);
          if (idx <= 0) return false;
          return activateNativeTab(siblings[idx - 1]);
        },

        async goToNextVerticalTab() {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const ws = currentTab.getAttribute("zen-workspace-id");
          const sameWorkspace = getAllTabElements().filter(
            (t) => t.getAttribute("zen-workspace-id") === ws
          );
          const idx = sameWorkspace.indexOf(currentTab);
          if (idx < 0 || idx === sameWorkspace.length - 1) return false;
          return activateNativeTab(sameWorkspace[idx + 1]);
        },

        // Return the DOM id of the tab that would be focused if the active
        // tab were closed right now (the browser's default Cmd+W successor).
        async getDefaultCloseTargetDomId() {
          const w = getWin();
          if (!w?.gBrowser) return null;
          const cur = w.gBrowser.selectedTab;
          if (!cur) return null;
          try {
            const next = w.gBrowser._findTabToBlurTo(cur);
            return next?.id || null;
          } catch (e) {
            return null;
          }
        },

        async goToPrevVerticalTab() {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const ws = currentTab.getAttribute("zen-workspace-id");
          const sameWorkspace = getAllTabElements().filter(
            (t) => t.getAttribute("zen-workspace-id") === ws
          );
          const idx = sameWorkspace.indexOf(currentTab);
          if (idx <= 0) return false;
          return activateNativeTab(sameWorkspace[idx - 1]);
        },

        async goToNextWorkspace() {
          return changeWorkspaceByOffset(+1);
        },

        async goToPrevWorkspace() {
          return changeWorkspaceByOffset(-1);
        },

        async togglePinTab() {
          const w = getWin();
          if (!w || !w.gBrowser) return false;
          const tab = w.gBrowser.selectedTab;
          if (!tab) return false;
          if (tab.hasAttribute("zen-essential")) return false;
          if (tab.pinned) {
            w.gBrowser.unpinTab(tab);
          } else {
            w.gBrowser.pinTab(tab);
          }
          return true;
        },

        async copyCurrentUrlMarkdown() {
          const w = getWin();
          if (!w || !w.gBrowser) return false;
          const tab = w.gBrowser.selectedTab;
          if (!tab) return false;
          const url = tab.linkedBrowser?.currentURI?.spec || "";
          if (!url) return false;
          const title = (tab.label || "").replace(/[\[\]]/g, "");
          const md = "[" + title + "](" + url + ")";
          try {
            const clip = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
            clip.copyString(md);
            return true;
          } catch (e) {
            return false;
          }
        },

        async restoreLastClosedTab() {
          const w = getWin();
          if (!w) return false;
          try {
            const SS = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs").SessionStore;
            if (!SS || SS.getClosedTabCount(w) === 0) return false;
            SS.undoCloseTab(w, 0);
            return true;
          } catch (e) {
            return false;
          }
        },

        async splitNew() {
          const w = getWin();
          if (!w?.gZenViewSplitter) return false;
          try { w.gZenViewSplitter.createEmptySplit("right"); return true; }
          catch (e) { return false; }
        },

        async splitClose() {
          const w = getWin();
          if (!w?.gZenViewSplitter) return false;
          try { w.gZenViewSplitter.unsplitCurrentView(); return true; }
          catch (e) { return false; }
        },

        async splitHorizontal() {
          const w = getWin();
          if (!w?.gZenViewSplitter) return false;
          try { w.gZenViewSplitter.toggleShortcut("hsep"); return true; }
          catch (e) { return false; }
        },

        async splitVertical() {
          const w = getWin();
          if (!w?.gZenViewSplitter) return false;
          try { w.gZenViewSplitter.toggleShortcut("vsep"); return true; }
          catch (e) { return false; }
        },

        // Close a tab by DOM id — works cross-workspace.
        async closeTabByDomId(domId) {
          const w = getWin();
          if (!w || !w.gBrowser) return false;

          const tab = findTabByDomId(domId);
          if (!tab) return false;

          // Never close pinned tabs (includes Essentials)
          if (tab.pinned) return false;

          w.gBrowser.removeTab(tab);
          return true;
        },

        // Get ALL tabs across ALL workspaces.
        async getAllTabs() {
          const tabElements = getAllTabElements();
          const w = getWin();
          const results = [];

          // Build a map of tab DOM ID → split group ID
          const tabToGroupId = new Map();
          if (w?.gZenViewSplitter?._data) {
            for (const group of w.gZenViewSplitter._data) {
              if (group.tabs) {
                for (const tab of group.tabs) {
                  tabToGroupId.set(tab.id, group.groupId);
                }
              }
            }
          }

          for (const tab of tabElements) {
            const extId = getExtTabId(tab);

            results.push({
              id: extId,
              domId: tab.id,
              title: tab.label || "",
              url: tab.linkedBrowser?.currentURI?.spec || "",
              workspaceId: tab.getAttribute("zen-workspace-id") || null,
              pinned: tab.pinned || false,
              active: tab.selected || false,
              lastAccessed: tab.lastAccessed || 0,
              favIconUrl: unwrapFavicon(tab.image),
              unread: tab.hasAttribute("unread"),
              openerTabDomId: tab.openerTab?.id || null,
              splitView: tab.hasAttribute("split-view"),
              splitGroupId: tabToGroupId.get(tab.id) || null,
              pending: tab.hasAttribute("pending"),
            });
          }
          return results;
        },

        // ---------------------------------------------------------------
        // Companion mod management
        // ---------------------------------------------------------------

        async getCompanionMods() {
          const w = getWin();
          const installedMods = (w && w.gZenMods) ? await w.gZenMods.getMods() : {};
          const result = [];
          for (const [id, def] of Object.entries(COMPANION_MODS)) {
            const installed = installedMods[id];
            result.push({
              id,
              name: def.name,
              description: def.description,
              installed: !!installed,
              installedVersion: installed?.version || null,
              latestVersion: def.version,
            });
          }
          return result;
        },

        async installCompanionMod(modId) {
          const def = COMPANION_MODS[modId];
          if (!def) return { success: false };

          const w = getWin();
          if (!w || !w.gZenMods) return { success: false };

          try {
            const { PathUtils, IOUtils } = w;

            const modFolder = PathUtils.join(w.gZenMods.modsRootPath, modId);
            await IOUtils.makeDirectory(modFolder, { ignoreExisting: true });
            await IOUtils.write(
              PathUtils.join(modFolder, "chrome.css"),
              new w.TextEncoder().encode(def.css)
            );

            const mods = await w.gZenMods.getMods();
            mods[modId] = {
              id: modId,
              name: "Zen Tabs Panel — " + def.name,
              description: def.description,
              author: "c13v",
              version: def.version,
              enabled: true,
            };
            await IOUtils.writeJSON(w.gZenMods.modsDataFile, mods);
            w.gZenMods.triggerModsUpdate();
            return { success: true };
          } catch (e) {
            console.error("[ZenTabsPanel] Failed to install mod " + modId + ":", e);
            return { success: false };
          }
        },

        async removeCompanionMod(modId) {
          const w = getWin();
          if (!w || !w.gZenMods) return { success: false };

          try {
            const { PathUtils, IOUtils } = w;

            const modFolder = PathUtils.join(w.gZenMods.modsRootPath, modId);
            await IOUtils.remove(modFolder, { recursive: true, ignoreAbsent: true });

            const mods = await w.gZenMods.getMods();
            delete mods[modId];
            await IOUtils.writeJSON(w.gZenMods.modsDataFile, mods);
            w.gZenMods.triggerModsUpdate();
            return { success: true };
          } catch (e) {
            console.error("[ZenTabsPanel] Failed to remove mod " + modId + ":", e);
            return { success: false };
          }
        },

        // Get DOM IDs of multiselected tabs (excludes essentials)
        async getSelectedTabDomIds() {
          const w = getWin();
          if (!w || !w.gBrowser) return [];
          return w.gBrowser.selectedTabs
            .filter(t => !t.hasAttribute("zen-essential"))
            .map(t => t.id);
        },

        async getSelectedTabUrls() {
          const w = getWin();
          if (!w || !w.gBrowser) return [];
          return w.gBrowser.selectedTabs
            .filter(t => !t.hasAttribute("zen-essential"))
            .map(t => t.linkedBrowser?.currentURI?.spec || "")
            .filter(url => url !== "");
        },

        async syncDuplicates() {
          syncDuplicateAttributes();
        },

        async getTabInfo(domId) {
          const w = getWin();
          if (!w || !w.gBrowser) return null;
          const tab = findTabByDomId(domId);
          if (!tab) return null;

          const url = tab.linkedBrowser?.currentURI?.spec || "";

          // Session history
          let sessionEntries = [];
          try {
            const state = JSON.parse(w.SessionStore.getTabState(tab));
            sessionEntries = (state.entries || []).map(e => ({
              url: e.url || "",
              title: e.title || "",
            }));
          } catch (e) {}

          // Memory and CPU via ChromeUtils.requestProcInfo
          let memory = null;
          let cpuTime = null;
          try {
            const outerWindowID = tab.linkedBrowser?.outerWindowID;
            if (outerWindowID) {
              const info = await ChromeUtils.requestProcInfo();
              for (const child of info.children) {
                for (const win of (child.windows || [])) {
                  if (win.outerWindowId === outerWindowID) {
                    memory = child.memory;
                    cpuTime = child.cpuTime;
                    break;
                  }
                }
                if (memory !== null) break;
              }
            }
          } catch (e) {}

          // Duplicates (includes self)
          const allTabs = getAllTabElements();
          const duplicateDomIds = allTabs
            .filter(t => (t.linkedBrowser?.currentURI?.spec || "") === url)
            .map(t => t.id);

          return {
            domId,
            title: tab.label || "",
            url,
            favIconUrl: unwrapFavicon(tab.image),
            pinned: tab.pinned || false,
            workspaceId: tab.getAttribute("zen-workspace-id") || null,
            lastAccessed: tab.lastAccessed || 0,
            status: tab.hasAttribute("pending") ? "unloaded" : "loaded",
            sessionEntries,
            memory,
            cpuTime,
            duplicateDomIds,
          };
        },

        async getEssentialTabIds() {
          const w = getWin();
          if (!w || !w.gBrowser) return [];
          return Array.from(w.document.querySelectorAll('.tabbrowser-tab[zen-essential]'))
            .map(t => {
              try { return context.extension.tabManager.getWrapper(t)?.id ?? null; } catch (e) { return null; }
            })
            .filter(id => id !== null);
        },

        async getNavigationHistory() {
          const w = getWin();
          if (!w || !w.gBrowser) return null;
          const tab = w.gBrowser.selectedTab;
          if (!tab) return null;
          try {
            const sh = tab.linkedBrowser.browsingContext?.sessionHistory;
            if (!sh) return null;
            const entries = [];
            for (let i = 0; i < sh.count; i++) {
              const entry = sh.getEntryAtIndex(i);
              entries.push({
                url: entry.URI?.spec || "",
                title: entry.title || "",
              });
            }
            return { entries, index: sh.index };
          } catch (e) {
            return null;
          }
        },

        async navigateToHistoryIndex(index) {
          const w = getWin();
          if (!w || !w.gBrowser) return;
          w.gBrowser.gotoIndex(index);
        },

        async scrollCurrentTabIntoView() {
          const w = getWin();
          if (!w || !w.gBrowser) return false;
          const tab = w.gBrowser.selectedTab;
          if (!tab) return false;
          tab.scrollIntoView({ block: "center", behavior: "smooth" });
          return true;
        },

        async previewTab(domId) {
          const tab = findTabByDomId(domId);
          if (!tab) return false;
          applyPreview(tab);
          return true;
        },

        async clearPreview() {
          clearPreviewState();
        },

        // Get workspaces with inline SVG icon content
        async getWorkspacesWithIcons() {
          const w = getWin();
          if (!w || !w.gZenWorkspaces) return [];
          const workspaces = w.gZenWorkspaces.getWorkspaces();
          const activeId = w.gZenWorkspaces.activeWorkspace;
          const results = [];
          for (const ws of workspaces) {
            let svgContent = "";
            if (ws.icon) {
              try {
                const resp = await w.fetch(ws.icon);
                svgContent = await resp.text();
              } catch (e) {}
            }
            results.push({ uuid: ws.uuid, name: ws.name, svgContent, isActive: ws.uuid === activeId });
          }
          return results;
        },

        // Move gBrowser.selectedTabs to the given workspace, placed at top
        async moveSelectedTabsToWorkspace(workspaceId) {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return;

          const tabs = w.gBrowser.selectedTabs.filter(t => !t.hasAttribute("zen-essential"));
          if (tabs.length === 0) return;

          // If the active tab is being moved, activate the previous tab first
          const activeTab = w.gBrowser.selectedTab;
          const movingActive = tabs.some(t => t === activeTab);

          if (movingActive) {
            // Reuse goToPreviousTab logic: find the most recently accessed non-visible tab
            const allTabs = getAllTabElements();
            const visibleDomIds = new Set();
            visibleDomIds.add(activeTab.id);
            if (w.gZenViewSplitter?._data) {
              const currentGroup = w.gZenViewSplitter._data.find(
                (g) => g.tabs && g.tabs.some((t) => t.id === activeTab.id)
              );
              if (currentGroup) {
                for (const tab of currentGroup.tabs) {
                  visibleDomIds.add(tab.id);
                }
              }
            }
            // Also exclude all tabs being moved
            for (const t of tabs) visibleDomIds.add(t.id);

            const candidates = allTabs
              .filter((t) => !visibleDomIds.has(t.id))
              .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
            if (candidates.length > 0) {
              await activateNativeTab(candidates[0]);
            }
          }

          // Use Zen's built-in moveTabsToWorkspace to handle all the
          // internal bookkeeping (split views, glance tabs, containers,
          // cached tab invalidation, etc.), then reorder to top.
          await w.gZenWorkspaces.moveTabsToWorkspace(tabs, workspaceId);

          // Move each tab to the top of its container (unpinned section).
          // moveTabsToWorkspace places them at the end — we want the top.
          // The tabs are now in the target workspace's DOM area. Access
          // the container from the tab element's parentNode.
          // Reverse iterate so the original order is preserved at the top.
          for (let i = tabs.length - 1; i >= 0; i--) {
            const tab = tabs[i];
            const container = tab.parentNode;
            if (!container) continue;
            // Find the first unpinned tab in this container as insertion point
            const firstUnpinned = Array.from(container.children).find(
              t => t.matches && t.matches(".tabbrowser-tab") && !t.pinned
            );
            if (firstUnpinned && firstUnpinned !== tab) {
              container.insertBefore(tab, firstUnpinned);
            }
          }
        },

        // Palette management.
        //
        // Returns a discriminated object describing what happened:
        //   {kind: "opened"}            — overlay opened (with main menu or a view)
        //   {kind: "closed"}            — overlay was already open and got closed (toggle)
        //   {kind: "chord-action",      — chord resolved to an action; caller should
        //          actionId}              dispatch it via runChordAction
        //   {kind: "chord-cancelled"}   — chord aborted (unknown key, Escape, blur)
        //
        // Callers:
        //   - commands.onCommand passes no arg → routes through chord engine
        //   - browserAction.onClicked passes {skipChord:true} → opens immediately
        //   - any caller can pass a view string to open directly to a submenu
        async showPalette(viewOrOpts) {
          let view = null;
          let skipChord = false;
          if (typeof viewOrOpts === "string") {
            view = viewOrOpts;
            skipChord = true;
          } else if (viewOrOpts && typeof viewOrOpts === "object") {
            view = viewOrOpts.view || null;
            skipChord = !!viewOrOpts.skipChord;
          }

          if (isOverlayOpen()) {
            destroyOverlay();
            return { kind: "closed" };
          }

          // Double-tap of the leader (or a click while chord is armed):
          // cancel the in-flight chord and open immediately.
          if (chordState !== null) {
            const resolve = chordResolve;
            chordResolve = null;
            disarmChord();
            openOverlayWithView(view);
            if (resolve) resolve({ kind: "opened" });
            return { kind: "opened" };
          }

          if (skipChord) {
            openOverlayWithView(view);
            return { kind: "opened" };
          }

          return new Promise((resolve) => armChord(resolve));
        },

        async hidePalette() {
          destroyOverlay();
        },

        async navigateToView(view, params) {
          if (!isOverlayOpen()) return;
          const parsed = params ? JSON.parse(params) : {};
          navStack.push({ view: currentViewName, params: {} });
          currentViewName = view;
          morphToView(view, parsed);
        },

        async navigateBack() {
          if (!isOverlayOpen()) return;
          if (navStack.length === 0) {
            destroyOverlay();
            return;
          }
          const prev = navStack.pop();
          currentViewName = prev.view;
          morphToView(prev.view, prev.params);
        },

      },
    };
  }
};