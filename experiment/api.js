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
        try { cancelSyncDuplicates(); } catch (e) {}
        try { teardownTabTracking(); } catch (e) {}
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

    // -----------------------------------------------------------------------
    // Persistent per-tab metadata (rides SessionStore.extData; survives restart)
    //
    // SessionStore.{set,get}TabValue writes into the tab's extData blob, which
    // Zen serializes into zen-sessions.jsonlz4 and restores when the tab is
    // restored. Tab DOM IDs regenerate on restart, so we anchor identity on a
    // stable per-tab UUID (panelTabUuid). Parent links store the parent's UUID
    // (panelParentUuid). Unread state and stats are stored under their own keys.
    // -----------------------------------------------------------------------

    let SS = null;
    let SS_GET = null;
    let SS_SET = null;
    try {
      SS = ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs"
      ).SessionStore;
      // Recent Firefox/Zen builds renamed get/setTabValue to get/setCustomTabValue.
      SS_GET = SS && (SS.getCustomTabValue || SS.getTabValue) || null;
      SS_SET = SS && (SS.setCustomTabValue || SS.setTabValue) || null;
    } catch (e) {
      SS = null;
    }

    const tabMemoryStore = new WeakMap();
    const STATS_VERSION = 1;
    const STATS_DEFAULT = Object.freeze({
      v: STATS_VERSION,
      focusCount: 0,
      focusDurationSeconds: 0,
      createdAt: 0,
      openerType: "unknown",
    });

    function readTabValue(tab, key) {
      try {
        if (SS_GET) {
          const raw = SS_GET.call(SS, tab, key);
          if (raw === undefined || raw === null || raw === "") return undefined;
          try { return JSON.parse(raw); } catch (e) { return raw; }
        }
      } catch (e) {}
      const mem = tabMemoryStore.get(tab);
      return mem ? mem[key] : undefined;
    }

    function writeTabValue(tab, key, value) {
      try {
        if (SS_SET) {
          SS_SET.call(SS, tab, key, JSON.stringify(value));
          return;
        }
      } catch (e) {}
      let mem = tabMemoryStore.get(tab);
      if (!mem) { mem = {}; tabMemoryStore.set(tab, mem); }
      mem[key] = value;
    }

    function generateUuid() {
      try {
        const w = getWin();
        if (w && w.crypto && typeof w.crypto.randomUUID === "function") {
          return w.crypto.randomUUID();
        }
      } catch (e) {}
      try {
        return Services.uuid.generateUUID().toString().slice(1, -1);
      } catch (e) {
        return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      }
    }

    function ensureTabUuid(tab) {
      let uuid = readTabValue(tab, "panelTabUuid");
      if (!uuid) {
        uuid = generateUuid();
        writeTabValue(tab, "panelTabUuid", uuid);
      }
      return uuid;
    }

    function readTabStats(tab) {
      const stored = readTabValue(tab, "panelStats");
      if (!stored || typeof stored !== "object") return { ...STATS_DEFAULT };
      if (stored.v !== STATS_VERSION) {
        return { ...STATS_DEFAULT, ...stored, v: STATS_VERSION };
      }
      return stored;
    }

    function writeTabStats(tab, patch) {
      const current = readTabStats(tab);
      writeTabValue(tab, "panelStats", { ...current, ...patch, v: STATS_VERSION });
    }

    // Focus tracking — chrome-side in-memory; deltas are flushed to panelStats
    // on switch / pause / close, never on a timer.
    //
    // Carry sub-second remainders in tabAccumMs (per-tab) so rapid intervals
    // accumulate across visits instead of each rounding to 0. Zen's workspace
    // switching can bounce TabSelect several times during a single user click.
    let focusState = { tab: null, startedAt: 0, paused: false };
    const tabAccumMs = new WeakMap();

    function recordInterval() {
      if (!focusState.tab || focusState.paused) return;
      const elapsed = Math.max(0, Date.now() - focusState.startedAt);
      if (elapsed === 0) return;
      const tab = focusState.tab;
      const total = (tabAccumMs.get(tab) || 0) + elapsed;
      const wholeSec = Math.floor(total / 1000);
      if (wholeSec > 0) {
        const stats = readTabStats(tab);
        stats.focusDurationSeconds = (stats.focusDurationSeconds || 0) + wholeSec;
        writeTabStats(tab, stats);
      }
      tabAccumMs.set(tab, total - wholeSec * 1000);
      focusState.startedAt = Date.now();
    }

    function endFocus() {
      recordInterval();
      focusState = { tab: null, startedAt: 0, paused: false };
    }

    function beginFocus(tab) {
      if (!tab) return;
      if (focusState.tab === tab && !focusState.paused) return;
      endFocus();
      try {
        ensureTabUuid(tab);
        const stats = readTabStats(tab);
        stats.focusCount = (stats.focusCount || 0) + 1;
        writeTabStats(tab, stats);
      } catch (e) {}
      focusState = { tab, startedAt: Date.now(), paused: false };
    }

    function pauseFocus() {
      if (!focusState.tab || focusState.paused) return;
      recordInterval();
      focusState.paused = true;
    }

    function resumeFocus() {
      if (!focusState.tab || !focusState.paused) return;
      focusState.startedAt = Date.now();
      focusState.paused = false;
    }

    // openerType detection: a short-lived hint flag set by chrome-side hooks
    // into the Places UI gets consumed by the next TabOpen event.
    let openerHint = null;
    let openerHintTimer = null;

    function setOpenerHint(hint) {
      openerHint = hint;
      const w = getWin();
      if (openerHintTimer && w) {
        try { w.clearTimeout(openerHintTimer); } catch (e) {}
      }
      if (w) {
        try {
          openerHintTimer = w.setTimeout(() => { openerHint = null; openerHintTimer = null; }, 500);
        } catch (e) {}
      }
    }

    function consumeOpenerHint() {
      const h = openerHint;
      openerHint = null;
      const w = getWin();
      if (openerHintTimer && w) {
        try { w.clearTimeout(openerHintTimer); } catch (e) {}
        openerHintTimer = null;
      }
      return h;
    }

    let placesHooksInstalled = false;
    function installPlacesHooks() {
      if (placesHooksInstalled) return;
      const w = getWin();
      if (!w) return;
      // Bookmarks toolbar / menu clicks
      try {
        const handler = w.BookmarksEventHandler;
        if (handler && typeof handler.onCommand === "function" && !handler.__zenTabsPanelHooked) {
          const orig = handler.onCommand;
          handler.onCommand = function (...args) {
            try { setOpenerHint("bookmark"); } catch (e) {}
            return orig.apply(this, args);
          };
          handler.__zenTabsPanelHooked = true;
        }
      } catch (e) {}
      // Generic Places UI opening (covers history menu, sidebar, library)
      try {
        const pui = w.PlacesUIUtils;
        if (pui && typeof pui.openNodeWithEvent === "function" && !pui.__zenTabsPanelHooked) {
          const orig = pui.openNodeWithEvent;
          pui.openNodeWithEvent = function (node, event, ...rest) {
            try {
              const itemId = node && node.itemId;
              if (typeof itemId === "number") {
                if (itemId > 0) setOpenerHint("bookmark");
                else if (itemId === -1 && node.uri) setOpenerHint("history");
              }
            } catch (e) {}
            return orig.call(this, node, event, ...rest);
          };
          pui.__zenTabsPanelHooked = true;
        }
      } catch (e) {}
      placesHooksInstalled = true;
    }

    function detectOpenerType(tab) {
      // Priority: hint (bookmark/history from Places hooks) > openerTab > window-blur (external) > manual.
      // Note: URL at TabOpen time is unreliable (often about:blank pre-navigation),
      // so we don't classify by URL — tabs from the URL bar and new-tab button
      // both fall through to "manual" since they're indistinguishable user actions.
      const hint = consumeOpenerHint();
      if (hint) return hint;
      try { if (tab.openerTab) return "tab"; } catch (e) {}
      try {
        const w = getWin();
        if (w && w.document && !w.document.hasFocus()) return "external";
      } catch (e) {}
      return "manual";
    }

    function onTabOpen(tab) {
      try {
        ensureTabUuid(tab);
        const openerType = detectOpenerType(tab);
        let parentUuid = null;
        try { if (tab.openerTab) parentUuid = ensureTabUuid(tab.openerTab); } catch (e) {}
        if (parentUuid) writeTabValue(tab, "panelParentUuid", parentUuid);
        writeTabValue(tab, "panelUnread", true);
        writeTabStats(tab, {
          createdAt: Date.now(),
          openerType,
          focusCount: 0,
          focusDurationSeconds: 0,
        });
      } catch (e) {}
    }

    function onTabSelect(tab) {
      try { beginFocus(tab); } catch (e) {}
    }

    function onTabClose(tab) {
      try { if (focusState.tab === tab) endFocus(); } catch (e) {}
    }

    function findTabByUuid(uuid) {
      if (!uuid) return null;
      const tabs = getAllTabElements();
      for (const t of tabs) {
        if (readTabValue(t, "panelTabUuid") === uuid) return t;
      }
      return null;
    }

    // Resolve a tab's parent: prefer runtime openerTab (live, no scan needed),
    // fall back to the persisted panelParentUuid lookup (survives restart).
    function resolveParentTab(tab) {
      if (!tab) return null;
      try { if (tab.openerTab) return tab.openerTab; } catch (e) {}
      const parentUuid = readTabValue(tab, "panelParentUuid");
      if (!parentUuid) return null;
      return findTabByUuid(parentUuid);
    }

    // Resolve all sibling tabs (including self) for a tab. Sibling = same parent.
    // Uses panelParentUuid first; falls back to openerTab object identity.
    function resolveSiblingTabs(tab) {
      if (!tab) return [];
      const parentUuid = readTabValue(tab, "panelParentUuid");
      const allTabs = getAllTabElements();
      if (parentUuid) {
        return allTabs.filter((t) => readTabValue(t, "panelParentUuid") === parentUuid);
      }
      try {
        if (tab.openerTab) {
          return allTabs.filter((t) => t.openerTab === tab.openerTab);
        }
      } catch (e) {}
      return [];
    }

    // Install our event listeners on the chrome window's tabContainer. Stash
    // the handler bag on the window itself so a re-install (extension reload
    // without a full close) can tear down the previous registration — relying
    // on context.callOnClose alone leaks listeners across disable+enable.
    const HANDLER_BAG_KEY = "__zenTabsPanelTabHandlers";
    let tabTrackingInstalled = false;
    let tabTrackingListeners = null;
    function ensureTabTracking() {
      if (tabTrackingInstalled) return;
      const w = getWin();
      if (!w || !w.gBrowser || !w.gBrowser.tabContainer) return;
      try {
        const prior = w[HANDLER_BAG_KEY];
        if (prior && prior.container) {
          try {
            prior.container.removeEventListener("TabOpen", prior.onOpen);
            prior.container.removeEventListener("TabSelect", prior.onSelect);
            prior.container.removeEventListener("TabClose", prior.onClose);
          } catch (e) {}
        }
        const onOpen = (e) => onTabOpen(e.target);
        const onSelect = (e) => onTabSelect(e.target);
        const onClose = (e) => onTabClose(e.target);
        w.gBrowser.tabContainer.addEventListener("TabOpen", onOpen);
        w.gBrowser.tabContainer.addEventListener("TabSelect", onSelect);
        w.gBrowser.tabContainer.addEventListener("TabClose", onClose);
        const bag = { container: w.gBrowser.tabContainer, onOpen, onSelect, onClose };
        w[HANDLER_BAG_KEY] = bag;
        tabTrackingListeners = bag;
        // Seed focus tracker with the currently selected tab so its duration
        // accumulates from now without incrementing focusCount.
        if (w.gBrowser.selectedTab) {
          ensureTabUuid(w.gBrowser.selectedTab);
          focusState = { tab: w.gBrowser.selectedTab, startedAt: Date.now(), paused: false };
        }
        // Re-apply the unread DOM attribute from our persisted state. Firefox
        // doesn't restore [unread] across session restore, but our companion
        // mod's blue dot reads that attribute. Walk all tabs once at install.
        try {
          for (const tab of getAllTabElements()) {
            const persistedUnread = readTabValue(tab, "panelUnread");
            if (persistedUnread === true && !tab.hasAttribute("unread")) {
              tab.setAttribute("unread", "true");
            }
          }
        } catch (e) {}
        installPlacesHooks();
        tabTrackingInstalled = true;
      } catch (e) {}
    }

    function teardownTabTracking() {
      try { recordInterval(); } catch (e) {}
      if (tabTrackingListeners) {
        try {
          const { container, onOpen, onSelect, onClose } = tabTrackingListeners;
          container.removeEventListener("TabOpen", onOpen);
          container.removeEventListener("TabSelect", onSelect);
          container.removeEventListener("TabClose", onClose);
        } catch (e) {}
        const w = getWin();
        if (w && w[HANDLER_BAG_KEY] === tabTrackingListeners) {
          delete w[HANDLER_BAG_KEY];
        }
        tabTrackingListeners = null;
      }
      tabTrackingInstalled = false;
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

    // Activate the unread tab with the highest (newest) or lowest (oldest)
    // lastAccessed timestamp across all tabs. Crosses workspaces using the
    // existing activateNativeTab helper.
    async function activateUnvisitedByOrder(order) {
      const tabs = getAllTabElements().filter((t) => t.hasAttribute("unread"));
      if (tabs.length === 0) return false;
      tabs.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
      const target = order === "newest" ? tabs[tabs.length - 1] : tabs[0];
      return activateNativeTab(target);
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

    const DUP_ATTR = "zen-tabs-panel-duplicate";
    const DUP_STYLE_ID = "zen-tabs-panel-dup-indicator-styles";
    const SYNC_DUP_DEBOUNCE_MS = 50;
    let dupStylesInjected = false;
    let syncDupDebounceTimer = null;

    function ensureDuplicateStyles() {
      if (dupStylesInjected) return;
      const w = getWin();
      if (!w) return;
      let el = w.document.getElementById(DUP_STYLE_ID);
      if (!el) {
        el = w.document.createElement("style");
        el.id = DUP_STYLE_ID;
        el.textContent = DUP_INDICATOR_CSS;
        w.document.documentElement.appendChild(el);
      } else if (el.textContent !== DUP_INDICATOR_CSS) {
        el.textContent = DUP_INDICATOR_CSS;
      }
      dupStylesInjected = true;
    }

    // Walk all tabs once to count URLs, then a second time to apply only the
    // diffs (gated by hasAttribute) — most calls in steady state mutate zero
    // attributes since dup status changes only when a tab navigates.
    function syncDuplicateAttributes() {
      ensureDuplicateStyles();
      const tabs = getAllTabElements();
      const urlCounts = new Map();
      for (let i = 0; i < tabs.length; i++) {
        const url = tabs[i].linkedBrowser?.currentURI?.spec || "";
        if (url && url !== "about:newtab" && url !== "about:blank") {
          urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
        }
      }
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const url = tab.linkedBrowser?.currentURI?.spec || "";
        const shouldBeDup = (urlCounts.get(url) || 0) > 1;
        const isDup = tab.hasAttribute(DUP_ATTR);
        if (shouldBeDup && !isDup) {
          tab.setAttribute(DUP_ATTR, "true");
        } else if (!shouldBeDup && isDup) {
          tab.removeAttribute(DUP_ATTR);
        }
      }
    }

    // Trailing-edge debounce: every call resets the timer so a burst of tab
    // events (e.g. the multiple URL-change notifications during one page
    // load) coalesces into a single attribute-update pass.
    function scheduleSyncDuplicates() {
      const w = getWin();
      if (!w) return;
      if (syncDupDebounceTimer !== null) {
        w.clearTimeout(syncDupDebounceTimer);
      }
      syncDupDebounceTimer = w.setTimeout(() => {
        syncDupDebounceTimer = null;
        syncDuplicateAttributes();
      }, SYNC_DUP_DEBOUNCE_MS);
    }

    function cancelSyncDuplicates() {
      if (syncDupDebounceTimer === null) return;
      const w = getWin();
      if (w) w.clearTimeout(syncDupDebounceTimer);
      syncDupDebounceTimer = null;
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
      actions:              { width: 960, height: 604 },
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
      "move-to-folder":     { width: 360, height: 604 },
      "open-in-container":  { width: 320, height: 604 },
      "extension-popup":    { width: 360, height: 500 },
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

    // Mirror whatever theme Zen's URL-bar dropdown (Cmd+T) uses. The
    // chrome root's resolved `color-scheme` is the same signal that dialog
    // reads, and it disagrees with both the `zen-should-be-dark-mode`
    // attribute and the inline `--toolbar-color-scheme` variable in some
    // workspaces (gradient-themed workspaces set the variable to "dark"
    // while the user's preferred mode is light, and the attribute can be
    // stale in either direction). Fall back to matchMedia when the
    // computed value is ambiguous ("light dark", "normal", etc.).
    function isChromeDark() {
      const w = getWin();
      const root = w?.document?.documentElement;
      if (!root || !w) return false;
      try {
        const cs = w.getComputedStyle(root).colorScheme;
        if (cs === "dark") return true;
        if (cs === "light") return false;
        if (w.matchMedia) {
          return w.matchMedia("(prefers-color-scheme: dark)").matches;
        }
      } catch (e) {}
      return false;
    }

    function getPaletteURL() {
      const isDark = isChromeDark();
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

    function createBrowserElement(w, size, opts) {
      const br = w.document.createXULElement("browser");
      br.id = BROWSER_ID;
      br.setAttribute("type", "content");
      br.setAttribute("remote", "true");
      br.setAttribute("maychangeremoteness", "true");
      br.setAttribute("disableglobalhistory", "true");
      br.setAttribute("messagemanagergroup", "webext-browsers");
      br.setAttribute("webextension-view-type", "popup");
      br.setAttribute("transparent", "true");
      if (opts?.remoteType) br.setAttribute("remoteType", opts.remoteType);
      br.setAttribute("src", opts?.src || getPaletteURL());
      br.style.cssText = "width:" + size.width + "px;height:" + size.height + "px;border:none;opacity:1";
      return br;
    }

    // Resolve foreign extension popup URL and pick a suitable icon size from
    // the manifest's default_icon (which is either a string or an object
    // keyed by pixel size).
    function pickIconUrl(icon) {
      if (!icon) return null;
      if (typeof icon === "string") return icon;
      const sizes = Object.keys(icon).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
      if (sizes.length === 0) return null;
      sizes.sort((a, b) => a - b);
      const ge32 = sizes.find((n) => n >= 32);
      const chosen = ge32 ?? sizes[sizes.length - 1];
      return icon[chosen] || icon[String(chosen)];
    }

    // Fetch a moz-extension:// icon URL and convert to a data: URL so the
    // popup content process (a different extension origin) can render it
    // without cross-extension web_accessible_resources.
    async function fetchIconAsDataUrl(url) {
      const w = getWin();
      if (!w || !url) return null;
      try {
        const resp = await w.fetch(url);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((resolve, reject) => {
          const reader = new w.FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        return null;
      }
    }

    let extensionListCache = null;
    async function buildExtensionList() {
      const { ExtensionParent } = ChromeUtils.importESModule(
        "resource://gre/modules/ExtensionParent.sys.mjs"
      );
      const w = getWin();
      const isPrivate = w?.PrivateBrowsingUtils?.isWindowPrivate?.(w) || false;
      const ownId = context.extension.id;

      const items = [];
      for (const [id, ext] of ExtensionParent.GlobalManager.extensionMap) {
        if (id === ownId) continue;
        const action = ext.manifest.action || ext.manifest.browser_action;
        const popupPath = action?.default_popup;
        if (!popupPath) continue;
        if (isPrivate && !ext.privateBrowsingAllowed) continue;

        // default_popup may be a relative path; resolve against the extension's baseURL.
        let popupUrl = popupPath;
        if (!/^moz-extension:\/\//.test(popupPath)) {
          popupUrl = ext.baseURL + popupPath.replace(/^\/+/, "");
        }
        const iconRaw = pickIconUrl(action.default_icon || ext.manifest.icons);
        let iconResolved = iconRaw;
        if (iconRaw && !/^moz-extension:\/\//.test(iconRaw)) {
          iconResolved = ext.baseURL + iconRaw.replace(/^\/+/, "");
        }
        const iconDataUrl = await fetchIconAsDataUrl(iconResolved);
        items.push({
          id,
          name: ext.manifest.name || id,
          popupUrl,
          iconDataUrl,
        });
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
      return items;
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

        let newBr;
        if (view === "extension-popup" && params?.popupUrl) {
          newBr = createBrowserElement(w, targetSize, {
            src: params.popupUrl,
            remoteType: "extension",
          });
        } else {
          pendingView = view === "actions" ? null : view;
          pendingParams = params || {};
          newBr = createBrowserElement(w, targetSize);
          pendingView = null;
          pendingParams = {};
        }
        newBr.style.opacity = "0";

        oldBrowser.remove();
        panel.appendChild(newBr);

        if (view === "extension-popup") {
          wireForeignPopupResizing(newBr, panel, gen);
          wireForeignPopupAutoClose(newBr);
        }

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

    // Resize the panel and browser to match the popup body's natural size.
    // Foreign extension popups set their own body dimensions; without this
    // they're letterboxed or cropped inside our default 360x500.
    //
    // Fission blocks chrome from reading the content-process `contentDocument`,
    // so we run the measurement inside the content process via a frame
    // script that posts dimensions back over the messageManager. The
    // frameLoader doesn't exist immediately after `appendChild`, so we wait
    // for the browser's load event before attaching.
    function wireForeignPopupResizing(br, panel, gen) {
      const FOREIGN_POPUP_MAX_W = 800;
      const FOREIGN_POPUP_MAX_H = 700;
      const FOREIGN_POPUP_MIN_W = 200;
      const FOREIGN_POPUP_MIN_H = 120;

      const applySize = (rawW, rawH) => {
        if (gen !== morphGeneration) return;
        const cw = Math.max(FOREIGN_POPUP_MIN_W, Math.min(FOREIGN_POPUP_MAX_W, rawW || 0));
        const ch = Math.max(FOREIGN_POPUP_MIN_H, Math.min(FOREIGN_POPUP_MAX_H, rawH || 0));
        if (!cw || !ch) return;
        panel.style.width = cw + "px";
        panel.style.maxHeight = ch + "px";
        br.style.width = cw + "px";
        br.style.height = ch + "px";
      };

      // Why this script is shaped the way it is:
      //
      // - We must run the measurement INSIDE the content process. Fission
      //   blocks chrome from reading `br.contentDocument` for a remote
      //   browser, so we ship the size-reporter into the page via a frame
      //   script and have it post results back over the messageManager.
      //
      // - We prefer body.scrollWidth/scrollHeight over documentElement.
      //   documentElement reports the iframe's current width — for popups
      //   that want less than our default (e.g. uBlock at 252px) it lies
      //   and we'd never shrink. Fall back to documentElement only when
      //   body isn't present yet.
      //
      // - A self-guard (`content.__zttResizeWired`) makes the script
      //   idempotent within a given content window. wireOnce gets called
      //   multiple times (XULFrameLoaderCreated event + setTimeout cascade
      //   + initial sync attach) to survive process switches, and each
      //   call must use a unique URL (Firefox dedupes loadFrameScript
      //   by URL). Without this guard, every successful load created a
      //   fresh ResizeObserver in the page, so popups with paint-time
      //   animations (e.g. Bitwarden's vault) ended up with 4-6 ROs all
      //   firing in parallel and racing to set the panel size — the
      //   panel visibly oscillated.
      const FRAME_SCRIPT_BODY =
        '(()=>{if(content.__zttResizeWired)return;content.__zttResizeWired=true;let observed=false;const send=()=>{const d=content.document;const b=d.body;const r=d.documentElement;let w,h;if(b&&b.scrollWidth){w=b.scrollWidth;h=b.scrollHeight;}else if(r){w=r.scrollWidth;h=r.scrollHeight;}if(!w||!h)return;sendAsyncMessage("ztt:popup-size",{w,h});};const observe=()=>{if(observed)return;const b=content.document.body;if(!b)return;observed=true;try{const ro=new content.ResizeObserver(send);ro.observe(b);ro.observe(content.document.documentElement);}catch(e){}};const tick=()=>{observe();send();};tick();content.addEventListener("DOMContentLoaded",tick,{once:true});content.addEventListener("load",tick,{once:true});})();';

      const w = getWin();
      // We listen on each XULFrameLoaderCreated firing because remoteType=
      // "extension" forces a process switch that destroys the placeholder
      // frameLoader (and its messageManager + any listeners we attached
      // to it). The setTimeout cascade is a belt for any case where the
      // event fires before frameLoader.messageManager is readable. Each
      // load uses a unique data: URL (cache-buster lives as a JS comment
      // INSIDE the body — the body of a data:URL is JS, so an unescaped
      // `&` query string is a syntax error). The content-side
      // __zttResizeWired guard inside FRAME_SCRIPT_BODY ensures only one
      // ResizeObserver gets installed regardless of how many times the
      // script lands in the same content window.
      const wireOnce = () => {
        if (gen !== morphGeneration) return;
        let mm;
        try { mm = br.frameLoader?.messageManager; } catch (e) {}
        if (!mm) return;
        try {
          mm.addMessageListener("ztt:popup-size", (m) => {
            const d = m.data || {};
            if (d.w && d.h) applySize(d.w, d.h);
          });
        } catch (e) {}
        const url = "data:," + encodeURIComponent("/*" + Date.now() + "_" + Math.random() + "*/" + FRAME_SCRIPT_BODY);
        try { mm.loadFrameScript(url, false); } catch (e) {}
      };
      br.addEventListener("XULFrameLoaderCreated", wireOnce);
      wireOnce();
      [200, 600, 1500].forEach((d) => w.setTimeout(wireOnce, d));
    }

    // Many popups dismiss themselves via window.close(). Watch for that
    // signal on our hosted browser's content window and tear down the
    // overlay in response.
    function wireForeignPopupAutoClose(br) {
      br.addEventListener("DOMWindowClose", (e) => {
        e.preventDefault();
        destroyOverlay();
      }, { capture: true });
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

        // Resolve parent tab using the persisted UUID first (survives restart),
        // falling back to the runtime openerTab reference. Returns null if
        // neither is available.
        // (function is hoisted closure-scope above)

        async goToParentTab() {
          ensureTabTracking();
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const parent = resolveParentTab(currentTab);
          if (!parent) return false;
          return activateNativeTab(parent);
        },

        async goToNextSibling() {
          ensureTabTracking();
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const siblings = resolveSiblingTabs(currentTab);
          if (!siblings.length) return false;
          const idx = siblings.indexOf(currentTab);
          if (idx < 0 || idx === siblings.length - 1) return false;
          return activateNativeTab(siblings[idx + 1]);
        },

        async goToPrevSibling() {
          ensureTabTracking();
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const siblings = resolveSiblingTabs(currentTab);
          if (!siblings.length) return false;
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

        async goBackInTab() {
          const w = getWin();
          if (!w?.gBrowser) return false;
          try {
            if (!w.gBrowser.canGoBack) return false;
            w.gBrowser.goBack();
            return true;
          } catch (e) { return false; }
        },

        async goForwardInTab() {
          const w = getWin();
          if (!w?.gBrowser) return false;
          try {
            if (!w.gBrowser.canGoForward) return false;
            w.gBrowser.goForward();
            return true;
          } catch (e) { return false; }
        },

        // ---------------------------------------------------------------
        // Page-2 actions: per-tab/page operations.
        //
        // Most of these dispatch chrome `<command>` or `<key>` elements
        // because the underlying functions (BrowserViewSource, etc.) are
        // defined in browser.js as scoped vars, not window properties, so
        // they aren't reachable via w.BrowserViewSource. Activating the
        // command element runs the same logic the menu uses.
        // ---------------------------------------------------------------

        async reloadTab() {
          const w = getWin();
          if (!w?.gBrowser) return false;
          try { w.gBrowser.reloadTab(w.gBrowser.selectedTab); return true; }
          catch (e) { return false; }
        },

        async reloadTabSkipCache() {
          const w = getWin();
          if (!w?.gBrowser) return false;
          try {
            // Bypass cache: include FLAG_BYPASS_CACHE | FLAG_BYPASS_PROXY.
            const flags = Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE
                        | Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY;
            w.gBrowser.reloadTab(w.gBrowser.selectedTab, flags);
            return true;
          } catch (e) { return false; }
        },

        async duplicateTab() {
          const w = getWin();
          if (!w?.gBrowser) return false;
          try { w.gBrowser.duplicateTab(w.gBrowser.selectedTab); return true; }
          catch (e) { return false; }
        },

        async toggleReaderMode() {
          const w = getWin();
          const cmd = w?.document.getElementById("View:ReaderView");
          if (!cmd) return false;
          try { cmd.doCommand(); return true; }
          catch (e) { return false; }
        },

        async viewPageSource() {
          const w = getWin();
          const key = w?.document.getElementById("key_viewSource");
          if (!key) return false;
          try {
            // <key> elements respond to .click() to dispatch their oncommand.
            // doCommand() works for <command> elements but not all <key>s.
            (key.doCommand ? key.doCommand() : key.click());
            return true;
          } catch (e) { return false; }
        },

        async viewPageInfo() {
          const w = getWin();
          const cmd = w?.document.getElementById("View:PageInfo");
          if (!cmd) return false;
          try { cmd.doCommand(); return true; }
          catch (e) { return false; }
        },

        async toggleMute() {
          const w = getWin();
          const tab = w?.gBrowser?.selectedTab;
          if (!tab) return false;
          try { tab.toggleMuteAudio(); return true; }
          catch (e) { return false; }
        },

        async resetPinnedTab() {
          const w = getWin();
          const cmd = w?.document.getElementById("cmd_zenPinnedTabReset");
          if (!cmd) return false;
          try { cmd.doCommand(); return true; }
          catch (e) { return false; }
        },

        async addToEssentials() {
          const w = getWin();
          const cmd = w?.document.getElementById("cmd_contextZenAddToEssentials");
          if (!cmd) return false;
          try { cmd.doCommand(); return true; }
          catch (e) { return false; }
        },

        async takeScreenshot() {
          const w = getWin();
          const cmd = w?.document.getElementById("Browser:Screenshot");
          if (!cmd) return false;
          try { cmd.doCommand(); return true; }
          catch (e) { return false; }
        },

        async togglePictureInPicture() {
          const w = getWin();
          const cmd = w?.document.getElementById("View:PictureInPicture");
          if (!cmd) return false;
          try { cmd.doCommand(); return true; }
          catch (e) { return false; }
        },

        async toggleFullScreen() {
          const w = getWin();
          const cmd = w?.document.getElementById("View:FullScreen");
          if (!cmd) return false;
          try { cmd.doCommand(); return true; }
          catch (e) { return false; }
        },

        async toggleDevTools() {
          const w = getWin();
          const key = w?.document.getElementById("key_toggleToolbox");
          if (!key) return false;
          try {
            (key.doCommand ? key.doCommand() : key.click());
            return true;
          } catch (e) { return false; }
        },

        async toggleBrowserToolbox() {
          const w = getWin();
          const key = w?.document.getElementById("key_browserToolbox");
          if (!key) return false;
          try {
            (key.doCommand ? key.doCommand() : key.click());
            return true;
          } catch (e) { return false; }
        },

        async openDownloads() {
          const w = getWin();
          const cmd = w?.document.getElementById("Tools:Downloads");
          if (!cmd) return false;
          try { cmd.doCommand(); return true; }
          catch (e) { return false; }
        },

        async openAddons() {
          const w = getWin();
          const cmd = w?.document.getElementById("Tools:Addons");
          if (!cmd) return false;
          try { cmd.doCommand(); return true; }
          catch (e) { return false; }
        },

        async openFirefoxView() {
          const w = getWin();
          if (!w) return false;
          try {
            if (w.FirefoxViewHandler && typeof w.FirefoxViewHandler.openTab === "function") {
              w.FirefoxViewHandler.openTab();
              return true;
            }
          } catch (e) {}
          try {
            w.gBrowser.loadOneTab("about:firefoxview", { inBackground: false });
            return true;
          } catch (e) {
            return false;
          }
        },

        async copyCurrentUrl() {
          const w = getWin();
          if (!w || !w.gBrowser) return false;
          const tab = w.gBrowser.selectedTab;
          if (!tab) return false;
          const url = tab.linkedBrowser?.currentURI?.spec || "";
          if (!url) return false;
          try {
            const clip = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
            clip.copyString(url);
            return true;
          } catch (e) {
            return false;
          }
        },

        // Activate the most-recently-accessed unread tab (newest unvisited).
        async activateUnvisitedNewest() {
          return activateUnvisitedByOrder("newest");
        },

        async activateUnvisitedOldest() {
          return activateUnvisitedByOrder("oldest");
        },

        // List Zen folders (tab groups) for the move-to-folder menu.
        // Folders are tab groups under gBrowser; gZenFolders adds the
        // workspace-aware UI on top, but the data lives on gBrowser.
        async getFolders() {
          const w = getWin();
          if (!w?.gBrowser?.getAllTabGroups) return [];
          try {
            const groups = w.gBrowser.getAllTabGroups() || [];
            return groups.map((g) => ({
              id: g.id || "",
              name: g.label || g.name || "Folder",
              workspaceId: g.getAttribute?.("zen-workspace-id") || null,
            }));
          } catch (e) { return []; }
        },

        async moveTabToFolder(folderId) {
          const w = getWin();
          if (!w?.gBrowser) return false;
          try {
            const tab = w.gBrowser.selectedTab;
            const group = w.gBrowser.getTabGroupById?.(folderId);
            if (!tab || !group || !w.gBrowser.moveTabToExistingGroup) return false;
            w.gBrowser.moveTabToExistingGroup(tab, group);
            return true;
          } catch (e) { return false; }
        },

        // Enumerate Firefox/Zen profiles from the toolkit profile service.
        // Same source `about:profiles` reads — rootDir is the unique key
        // (names can technically collide), so identity checks use it.
        async getProfiles() {
          const ps = Cc["@mozilla.org/toolkit/profile-service;1"]
            .getService(Ci.nsIToolkitProfileService);
          const current = ps.currentProfile;
          const def = ps.defaultProfile;
          const out = [];
          for (const p of ps.profiles) {
            out.push({
              name: p.name,
              rootPath: p.rootDir.path,
              isCurrent: current ? p.rootDir.equals(current.rootDir) : false,
              isDefault: def ? p.rootDir.equals(def.rootDir) : false,
            });
          }
          return out;
        },

        // Launch a new Zen instance against the given profile — same call the
        // "Launch profile in new browser" button on about:profiles uses.
        async launchProfile(name) {
          const ps = Cc["@mozilla.org/toolkit/profile-service;1"]
            .getService(Ci.nsIToolkitProfileService);
          for (const p of ps.profiles) {
            if (p.name === name) {
              Services.startup.createInstanceWithProfile(p);
              return true;
            }
          }
          throw new Error(`Profile not found: ${name}`);
        },

        // Reopen the active tab in the given contextual identity (container).
        async reopenInContainer(userContextId) {
          const w = getWin();
          if (!w?.gBrowser) return false;
          try {
            const oldTab = w.gBrowser.selectedTab;
            const url = oldTab.linkedBrowser?.currentURI?.spec || "about:newtab";
            const newTab = w.gBrowser.addTab(url, {
              userContextId,
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            });
            w.gBrowser.selectedTab = newTab;
            return true;
          } catch (e) { return false; }
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
          ensureTabTracking();
          // Commit any in-progress focus duration so the popup sees fresh stats
          // for the currently-focused tab without waiting for a tab switch.
          try { recordInterval(); } catch (e) {}
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
            const panelTabUuid = ensureTabUuid(tab);
            const panelParentUuid = readTabValue(tab, "panelParentUuid") || null;
            const persistedUnread = readTabValue(tab, "panelUnread");
            const panelStats = readTabStats(tab);

            results.push({
              id: extId,
              domId: tab.id,
              title: tab.label || "",
              url: tab.linkedBrowser?.currentURI?.spec || "",
              workspaceId: tab.getAttribute("zen-workspace-id") || null,
              pinned: tab.pinned || false,
              essential: tab.hasAttribute("zen-essential"),
              active: tab.selected || false,
              lastAccessed: tab.lastAccessed || 0,
              favIconUrl: unwrapFavicon(tab.image),
              unread: tab.hasAttribute("unread") || persistedUnread === true,
              openerTabDomId: tab.openerTab?.id || null,
              splitView: tab.hasAttribute("split-view"),
              splitGroupId: tabToGroupId.get(tab.id) || null,
              pending: tab.hasAttribute("pending"),
              panelTabUuid,
              panelParentUuid,
              panelStats,
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

        // Coalesce bursts of tab events (page-load fires multiple URL
        // changes) into a single attribute-update pass via the trailing-
        // edge debounce in scheduleSyncDuplicates().
        async syncDuplicates() {
          scheduleSyncDuplicates();
        },

        // ---------------------------------------------------------------
        // Persistent tab metadata controls
        // ---------------------------------------------------------------

        async initTabTracking() {
          ensureTabTracking();
          return true;
        },

        async markTabVisitedByExtId(extId) {
          ensureTabTracking();
          const w = getWin();
          if (!w || !w.gBrowser) return false;
          let tab = null;
          try {
            tab = context.extension.tabManager.get(extId)?.nativeTab || null;
          } catch (e) {}
          if (!tab) return false;
          if (readTabValue(tab, "panelUnread") !== false) {
            writeTabValue(tab, "panelUnread", false);
          }
          if (tab.hasAttribute("unread")) {
            try { tab.removeAttribute("unread"); } catch (e) {}
          }
          return true;
        },

        async pauseFocusTracking() {
          ensureTabTracking();
          pauseFocus();
        },

        async resumeFocusTracking() {
          ensureTabTracking();
          resumeFocus();
        },

        async getTabUuid(domId) {
          ensureTabTracking();
          const tab = findTabByDomId(domId);
          if (!tab) return null;
          return ensureTabUuid(tab);
        },

        async getTabInfo(domId) {
          ensureTabTracking();
          try { recordInterval(); } catch (e) {}
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

          // Persisted metadata
          const panelTabUuid = ensureTabUuid(tab);
          const panelParentUuid = readTabValue(tab, "panelParentUuid") || null;
          const panelStats = readTabStats(tab);
          let parentTitle = null;
          let parentDomId = null;
          let parentFavIconUrl = null;
          if (panelParentUuid) {
            const parentTab = findTabByUuid(panelParentUuid);
            if (parentTab) {
              parentTitle = parentTab.label || "";
              parentDomId = parentTab.id;
              parentFavIconUrl = unwrapFavicon(parentTab.image);
            }
          }

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
            panelTabUuid,
            panelParentUuid,
            panelStats,
            parentTitle,
            parentDomId,
            parentFavIconUrl,
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

        // Refocus the popup <browser> after an action that activates a
        // different tab (e.g. sessions.restore). Without this, keyboard
        // focus stays on the newly-activated tab, so arrow keys scroll
        // the page instead of navigating the menu.
        async focusPalette() {
          const w = getWin();
          if (!w) return;
          const br = w.document.getElementById(BROWSER_ID);
          if (br) br.focus();
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

        // Enumerate installed extensions with a browser_action popup and
        // return their id, name, popup URL, and icon as a data URL the
        // popup content process can render.
        async listBrowserActionExtensions() {
          if (!extensionListCache) {
            extensionListCache = await buildExtensionList();
          }
          return extensionListCache;
        },

        // Swap the palette into a foreign extension's popup.
        async openExtensionPopup(extensionId) {
          if (!isOverlayOpen()) return;
          if (!extensionListCache) {
            extensionListCache = await buildExtensionList();
          }
          const found = extensionListCache.find((x) => x.id === extensionId);
          if (!found) return;
          navStack.push({ view: currentViewName, params: {} });
          currentViewName = "extension-popup";
          morphToView("extension-popup", { popupUrl: found.popupUrl, extensionId });
        },

      },
    };
  }
};