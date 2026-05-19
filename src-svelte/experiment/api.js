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
        try { teardownChordEngines(); } catch (e) {}
        try { teardownDuplicateLinkIndicator(); } catch (e) {}
        try { teardownDuplicateLinkInterceptor(); } catch (e) {}
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
      let s = String(url);
      if (s.startsWith("moz-remote-image://")) {
        const match = s.match(/[?&]url=([^&#]+)/);
        if (!match) return "";
        try {
          s = decodeURIComponent(match[1]);
        } catch (e) {
          return "";
        }
      }
      if (!s || s.startsWith("chrome://")) return "";
      return s;
    }

    // Get all tab elements across all workspaces from the DOM
    function getAllTabElements() {
      const w = getWin();
      if (!w || !w.document) return [];
      return Array.from(w.document.querySelectorAll(".tabbrowser-tab"));
    }

    // True for any URL that should be excluded from lastAccessed-based
    // navigation (previous tab, recents, etc.). Landing in an empty
    // workspace or opening a fresh tab shouldn't poison the recency
    // ordering — the chord-driven "previous" should jump back to the
    // last *real* tab the user was on.
    function isNewTabUrl(url) {
      return !url || url === "about:newtab" || url === "about:blank" || url === "about:home";
    }
    function isNewTabElement(tab) {
      return isNewTabUrl(tab?.linkedBrowser?.currentURI?.spec || "");
    }

    // Tabs the next tab-action should operate on. With a multi-selection
    // in the sidebar this is the whole selection (Zen exposes the
    // selection as gBrowser.selectedTabs, which always includes the
    // active tab plus any cmd-clicked others); otherwise just the
    // active tab. Multi-aware action handlers iterate over this list;
    // active-only handlers (navigation, view-source/PIP/etc.) bypass
    // it and use gBrowser.selectedTab directly.
    function getActionTargetTabs() {
      const w = getWin();
      if (!w?.gBrowser) return [];
      const sel = w.gBrowser.selectedTabs;
      if (Array.isArray(sel) && sel.length > 0) return Array.from(sel);
      const active = w.gBrowser.selectedTab;
      return active ? [active] : [];
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
    //
    // `excludeDomIds` is a list of tab DOM ids to skip — used by
    // closeAndSelect when the user multi-selected (so we don't pick a
    // successor that's about to be closed alongside).
    async function activateUnvisitedByOrder(order, excludeDomIds) {
      const skip = new Set(Array.isArray(excludeDomIds) ? excludeDomIds : []);
      const tabs = getAllTabElements().filter(
        (t) => t.hasAttribute("unread") && !skip.has(t.id)
      );
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
        const lastSelectedTabs = w.gZenWorkspaces.lastSelectedWorkspaceTabs;
        const previousLastSelected = lastSelectedTabs && lastSelectedTabs[tabWorkspace];
        if (lastSelectedTabs) {
          lastSelectedTabs[tabWorkspace] = tab;
        }
        try {
          await w.gZenWorkspaces.changeWorkspaceWithID(tabWorkspace);
        } catch (error) {
          if (lastSelectedTabs) {
            lastSelectedTabs[tabWorkspace] = previousLastSelected;
          }
          throw error;
        }
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

    // Per-view dimensions. `width` is fixed (so chord-chain navigation
    // doesn't reflow horizontally). `height` is a MAXIMUM — the popup
    // measures its natural content height after rendering and sends a
    // resize-panel message with the actual height; resizePanelToView
    // caps that to VIEW_SIZES[view].height so list-y views with many
    // rows still get a scrollable bounded panel instead of growing
    // off-screen.
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
      "move-to-workspace":  { width: 360, height: 604 },
      "close-and-select":   { width: 600, height: 604 },
      "move-to-folder":     { width: 360, height: 604 },
      "split-view":         { width: 360, height: 604 },
      "open-in-container":  { width: 320, height: 604 },
      "profiles":           { width: 360, height: 604 },
      "duplicate-prompt":   { width: 420, height: 604 },
      "extension-popup":    { width: 360, height: 500 },
    };

    // Chord engine: same shared/chord-engine.js module instantiated here
    // (chrome side) and in the per-content-process frame script (see below).
    // Both engines are armed in parallel by armChord (commands.onCommand →
    // chrome arms synchronously + targeted IPC arms the focused tab's
    // content engine). Whichever engine sees the next chord key processes
    // it; the other resets via cross-process IPC when chrome receives the
    // firing engine's output message. The chord tree is built from the
    // shared keybindings registry (shared/keybindings.js) so chord
    // shortcuts and popup-menu hotkey badges stay in sync.
    const engineScope = {};
    Services.scriptloader.loadSubScript(
      context.extension.getURL("shared/keybindings.js"),
      engineScope
    );
    Services.scriptloader.loadSubScript(
      context.extension.getURL("shared/constants.js"),
      engineScope
    );
    Services.scriptloader.loadSubScript(
      context.extension.getURL("shared/chord-engine.js"),
      engineScope
    );
    const KEYBINDINGS = engineScope.ZEN_KEYBINDINGS || [];
    const WORKSPACE_DIGIT_CHORDS = engineScope.ZEN_WORKSPACE_DIGIT_CHORDS || [];
    const tabIndexScope = {};
    Services.scriptloader.loadSubScript(
      context.extension.getURL("experiment/tab-index.js"),
      tabIndexScope
    );
    const tabIndex = tabIndexScope.createZenTabIndex({
      getWin,
      getAllTabElements,
      getExtTabId,
      unwrapFavicon,
      readTabValue,
      readTabStats,
      ensureTabUuid,
      recordInterval,
    });
    context.callOnClose({
      close() {
        try { tabIndex.stop(); } catch (e) {}
      },
    });
    // Mutable so the user's chordDelayMs setting can override at runtime.
    // The engine reads `constants.CHORD_*_TIMEOUT_MS` on each timer set,
    // so mutations apply to the next chord without rebuilding the engine.
    // applyChordDelay below mutates the same object and broadcasts the
    // new value to content frame scripts.
    const CHORD_CONSTANTS = {
      CHORD_ROOT_TIMEOUT_MS:   engineScope.CHORD_ROOT_TIMEOUT_MS   || 350,
      CHORD_PREFIX_TIMEOUT_MS: engineScope.CHORD_PREFIX_TIMEOUT_MS || 350,
      CHORD_REVEAL_TIMEOUT_MS: engineScope.CHORD_REVEAL_TIMEOUT_MS || 350,
    };
    // Current chord delay (for getPaletteURL's ?delay=N param, etc.).
    let chordDelayMs = CHORD_CONSTANTS.CHORD_ROOT_TIMEOUT_MS;
    function applyChordDelay(ms) {
      if (typeof ms !== "number" || ms < 0) return;
      chordDelayMs = ms;
      CHORD_CONSTANTS.CHORD_ROOT_TIMEOUT_MS = ms;
      CHORD_CONSTANTS.CHORD_PREFIX_TIMEOUT_MS = ms;
      CHORD_CONSTANTS.CHORD_REVEAL_TIMEOUT_MS = ms;
      try {
        Services.mm.broadcastAsyncMessage("ZenChord:SetDelay", { ms });
      } catch (e) {}
    }
    // Mutable so the dynamic Shift+1..9 extension-popup chords (added by
    // buildExtensionList below) can be appended after the static tree is
    // built. The chrome engine reads from this reference at match time, so
    // mutations take effect immediately for the chrome side. Frame-script
    // engines receive these dynamic entries via broadcast (see below).
    const CHORD_TREE = engineScope.buildChordTree(
      KEYBINDINGS,
      WORKSPACE_DIGIT_CHORDS,
      CHORD_CONSTANTS
    );
    // Track dynamic chord entries so newly-spawned content frame scripts
    // can request the current set on init.
    const dynamicChordEntries = [];

    let navStack = [];
    let currentViewName = null;
    let morphGeneration = 0;
    // Set by createOverlay to the function that flips the (initially hidden)
    // overlay to visible and starts the in animations. Stays non-null until
    // the overlay is revealed or destroyed. When the chord engine prerenders
    // during its wait window (via onArmed), this is what enterBridgeFromOpenView
    // / revealOverlay surface to display the already-loaded popup with no
    // further delay.
    let pendingReveal = null;
    let explicitRevealToken = 0;

    // Chrome engine instance is constructed later in this getAPI body once
    // the helpers it depends on (createOverlay, runChordAction, etc.) are
    // declared. The variable is hoisted here so functions defined above the
    // construction site (destroyOverlay etc.) can reference it for state
    // queries.
    let chromeEngine = null;
    // Per-content-process frame script registration handle. Populated once
    // by installContentEngineFrameScript() below.
    let contentEngineFrameScriptUrl = null;
    // Unique generation tag for this extension-load instance. Embedded into
    // the frame script body so each content-process engine knows its own
    // generation. Chrome ignores incoming ZenChord:* messages whose gen
    // doesn't match — this filters out keystrokes from stale frame scripts
    // that Firefox left running in content processes after a prior
    // extension reload (Firefox provides no way to unload frame scripts on
    // extension teardown).
    const CHORD_GENERATION = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8);
    // Chrome-side bridge buffer. Filled by either engine (chrome's engine
    // pushes via its onBridgeKey callback; content engines push via the
    // ZenChord:BridgeKey IPC). Drained by takeChordBridgeBuffer() when the
    // popup signals POPUP_READY. After POPUP_READY, new bridge keys are
    // forwarded directly to the popup browser's message manager rather
    // than buffered — see forwardKeyToPopup().
    let bridgeBuffer = null;
    let bridgeTimer = null;
    // Keep this comfortably above cold Svelte view startup in large tab
    // profiles. Fast chains like cmd+.,q,1 buffer row-selection digits in
    // chrome until POPUP_READY; timing out too early discards the digits and
    // leaves the user at the first view.
    const BRIDGE_TIMEOUT_MS = 8000;
    // Reveal-on-pause: while in bridging state, chrome keeps the popup
    // invisible so fast chord chains can navigate without showing UI.
    // If no chord key arrives within CHORD_REVEAL_TIMEOUT_MS, the popup
    // is revealed at its current view+context. Reset on every forwarded
    // key (user is still actively chording).
    let revealTimer = null;
    // True once the popup has signaled POPUP_READY for the current chord
    // chain. Before that, bridge keys are buffered. After, they are
    // delivered live via the popup browser's message manager.
    let popupReady = false;
    // The chord-tree path the engine was at when it transitioned to
    // bridging — passed to the popup on POPUP_READY so its engine
    // resumes at the same node.
    let pendingStateSnapshot = null;
    // Which engine instance fired the open-view that triggered the active
    // bridge — exit-bridge must be sent to it (and only it) when popup
    // drains. "chrome" or "content"; null when no bridge active.
    let bridgingEngineKind = null;
    // Last completed chord, for the cmd+.,. replay action. Captures
    // what the *engine* did (not the resolved popup-fired action) so
    // replay re-runs the chord chain — e.g. cmd+.,r,2 records
    // {kind:"open-view", view:"last-visited", bridgeKeys:["2"]} so
    // replay re-navigates to recents and re-fires "2", which cycles
    // through recents instead of activating the same now-current tab.
    //
    // For an engine action chord (cmd+.,p), records
    // {kind:"action", actionId:"go-to-previous-tab"} and replay
    // dispatches that action directly.
    //
    // currentChordReplay tracks the in-flight chain; bridge keys
    // append into it. lastChordReplay points to the last committed
    // chain. Reused across replays — replaying re-pushes the same
    // bridge keys, so the trace stays valid for the next replay.
    let lastChordReplay = null;
    let currentChordReplay = null;
    // Popup-instance counter. Incremented in createOverlay; the popup
    // reads it from its URL (?inst=N) and echoes it back in POPUP_READY.
    // takeChordBridgeBuffer ignores POPUP_READY whose inst doesn't match
    // the current popup. Without this, a destroyed prerender popup's
    // POPUP_READY (delivered to chrome after the prerender was torn down
    // by a prerender swap) would drain the bridge buffer that the NEW
    // popup is supposed to consume, losing the chord-chain digits.
    let popupInstance = 0;
    // Reveal-blocked flag: set the moment destroyOverlay starts tearing
    // down a popup, cleared the next time createOverlay runs. Any
    // revealPalette call landing in this window (e.g. the popup's own
    // post-dispatch reveal timer firing right as a terminal action's
    // destroy round-trip completes) is suppressed. Without this, the
    // popup-side 400ms timer races against the destroy IPC chain and
    // sometimes wins → brief flash before destroy.
    let revealBlocked = false;
    // Reveal-pending flag: set if the chrome reveal timer fired while
    // popup wasn't ready yet. takeChordBridgeBuffer consumes this and
    // reveals immediately on POPUP_READY — without it, the chrome
    // timer would have to either fire blindly (blank panel flash) or
    // poll, neither of which is right.
    let revealDeferred = false;
    let lastLeaderArmAt = 0;

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

    function getPaletteURL(view, params) {
      const isDark = isChromeDark();
      let url = context.extension.getURL("popup/popup.html") + "?theme=" + (isDark ? "dark" : "light");
      url += "&inst=" + popupInstance;
      url += "&gen=" + encodeURIComponent(CHORD_GENERATION);
      // Current chord-delay setting — popup's keyboard.js reads it and
      // overrides its reveal-timer duration.
      url += "&delay=" + chordDelayMs;
      if (view) url += "&view=" + encodeURIComponent(view);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(v);
        }
      }
      return url;
    }

    function paletteURLView(br) {
      const spec = String(br?.currentURI?.spec || br?.getAttribute?.("src") || "");
      const match = /[?&]view=([^&]+)/.exec(spec);
      if (!match) return "actions";
      try { return decodeURIComponent(match[1]); }
      catch (e) { return match[1]; }
    }

    function getViewSize(view) {
      return VIEW_SIZES[view] || VIEW_SIZES["actions"];
    }

    function browserMessageManager(br) {
      if (!br) return null;
      try {
        if (br.messageManager) return br.messageManager;
      } catch (e) {}
      try {
        if (br.frameLoader && br.frameLoader.messageManager) return br.frameLoader.messageManager;
      } catch (e) {}
      return null;
    }

    function createBrowserElement(w, size, opts) {
      const br = w.document.createXULElement("browser");
      br.id = BROWSER_ID;
      br.setAttribute("type", "content");
      br.setAttribute("remote", "true");
      br.setAttribute("maychangeremoteness", "true");
      br.setAttribute("disableglobalhistory", "true");
      br.setAttribute("messagemanagergroup", "webext-browsers");
      // webextension-view-type controls what browser.extension.getViews({type})
      // reports for this browser. Default "popup" matches the toolbar BAP
      // popup, which is right for our icon-strip flow. For windows.create
      // interception we want to mimic a real popout window — those have
      // no view-type set, and extensions (Bitwarden in particular) use
      // getViews({type:"popup"}).length === 0 to detect popout mode and
      // hide the "Pop out into new window" button.
      const viewType = opts && "viewType" in opts ? opts.viewType : "popup";
      if (viewType !== null) br.setAttribute("webextension-view-type", viewType);
      br.setAttribute("transparent", "true");
      if (opts?.remoteType) br.setAttribute("remoteType", opts.remoteType);
      br.setAttribute("src", opts?.src || getPaletteURL(opts?.view, opts?.params));
      // Declare the size transition up front so resizePanelToView's
      // width/height changes animate in sync with the panel's transition
      // — without it, the browser snaps to the new size on the first
      // navigation and the panel arrives late.
      br.style.cssText = "width:" + size.width + "px;height:" + size.height + "px;border:none;opacity:1;transition:width 0.15s ease-out, height 0.15s ease-out";
      return br;
    }

    function kickBrowserLoad(br) {
      if (!br) return;
      let src = "";
      try { src = br.getAttribute("src") || ""; } catch (e) {}
      if (!src) return;
      try {
        br.removeAttribute("src");
        br.setAttribute("src", src);
      } catch (e) {}
    }

    function scheduleBrowserLoadKicks(w, br) {
      if (!w || !br) return;
      w.setTimeout(() => kickBrowserLoad(br), 0);
      w.setTimeout(() => kickBrowserLoad(br), 50);
      w.setTimeout(() => kickBrowserLoad(br), 200);
    }

    // Resolve foreign extension popup URL and pick a suitable icon size from
    // the manifest's default_icon (which is either a string or an object
    // keyed by pixel size).
    function pickIconUrl(icon) {
      if (!icon) return null;
      if (typeof icon === "string") return icon;
      const sizes = Object.keys(icon).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
      if (sizes.length === 0) return null;
      // Pick the largest available source — we render at 24×24 CSS pixels
      // which is 48 device pixels on a 2× display, so scaling DOWN from a
      // larger source is always crisper than scaling up from a 32px PNG.
      sizes.sort((a, b) => a - b);
      const chosen = sizes[sizes.length - 1];
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
    // Per-extension natural-size cache, keyed by extension id. Once a
    // popup reports its body dimensions, subsequent opens skip the
    // 360×500 default and morph straight to the remembered size, so
    // the user sees one transition instead of two.
    const extensionPopupSizeCache = Object.create(null);
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
      // Mirror the popup's Shift+1..9 quick-launch into the chord tree
      // so the same shortcut works from outside an open palette
      // (leader chord → Shift+N opens the Nth extension's popup directly,
      // just like clicking the icon does). Inject into the chrome-side
      // CHORD_TREE (the chrome engine reads from it at match time) AND
      // broadcast to every content-process frame script so their local
      // tree copies stay in sync.
      //
      // Clear any prior entries first — the extension set can change as
      // the user installs/uninstalls add-ons. Replacing the whole 1..9
      // range keeps both sides consistent.
      dynamicChordEntries.length = 0;
      for (let i = 0; i < Math.min(items.length, 9); i++) {
        const key = "Shift+" + (i + 1);
        const node = {
          type: "open-extension-popup",
          extensionId: items[i].id,
        };
        CHORD_TREE.children[key] = node;
        const entry = { key, node };
        dynamicChordEntries.push(entry);
        try {
          Services.mm.broadcastAsyncMessage("ZenChord:AddChord", entry);
        } catch (e) {}
      }
      return items;
    }

    // Eagerly populate the extension list at api startup so chord
    // shortcuts (leader-chord → Shift+N) work without the user having
    // to open the palette first. Fire-and-forget — chord lookups
    // before this resolves just fall through to "unknown key", which
    // is no worse than the pre-existing behavior.
    buildExtensionList()
      .then((list) => { extensionListCache = list; })
      .catch(() => {});

    // Open a foreign extension's popup, creating the overlay first if
    // needed. Both the in-palette icon click (via openExtensionPopup
    // API method) and the chord-engine shortcut path route through here.
    async function openExtensionPopupInternal(extensionId) {
      if (!extensionListCache) {
        extensionListCache = await buildExtensionList();
      }
      const found = extensionListCache.find((x) => x.id === extensionId);
      if (!found) return;
      if (!isOverlayOpen()) {
        openOverlayWithView(null);
      }
      navStack.push({ view: currentViewName, params: {} });
      currentViewName = "extension-popup";
      morphToView("extension-popup", { popupUrl: found.popupUrl, extensionId });
    }

    // -----------------------------------------------------------------------
    // windows.create({type:"popup"}) interception
    //
    // Catches Bitwarden's biometric prompt, "Pop out into new window", and any
    // other foreign-extension popup window before it materializes as a real
    // OS window. We monkey-patch Services.ww.openWindow with a wrapper that
    // checks every call for the extension-popup signature (popup-style
    // features + a moz-extension:// URL in the args array) and routes
    // matches into our existing overlay-morph pipeline. Misses pass through
    // unchanged, so DevTools / view-source / sessionstore restore / etc. are
    // unaffected.
    //
    // Gated by the `interceptExtensionPopups` setting — background.js
    // pushes the current value via setExtensionPopupIntercept(...).
    //
    // The original openWindow is restored on addon unload (context.callOnClose
    // below) so we don't leave a dangling wrapper in the parent process.
    // -----------------------------------------------------------------------

    // Resolve a moz-extension URL to the owning extension's id by matching
    // the UUID host against ExtensionParent.GlobalManager.extensionMap.
    function findExtensionByUrl(popupUrl) {
      const m = /^moz-extension:\/\/([^/]+)\//.exec(popupUrl || "");
      if (!m) return null;
      const uuid = m[1];
      try {
        const { ExtensionParent } = ChromeUtils.importESModule(
          "resource://gre/modules/ExtensionParent.sys.mjs"
        );
        for (const [id, ext] of ExtensionParent.GlobalManager.extensionMap) {
          if (ext.uuid === uuid) return { id, ext };
        }
      } catch (e) {}
      return null;
    }

    async function openExtensionPopupByUrl(popupUrl) {
      const resolved = findExtensionByUrl(popupUrl);
      if (!resolved) return;
      // Popups commonly call window.close() on themselves right after
      // windows.create() to dismiss the originating instance. If we're
      // intercepting and that originating instance is the one inside
      // our overlay (case: user clicked "pop out" from a popup we're
      // already hosting), the close() would otherwise tear down our
      // overlay before the morph swaps in the new popup URL. Suppress
      // the DOMWindowClose handler for long enough that the morph
      // removes the old browser (and its listener) first.
      suppressAutoCloseUntil = Date.now() + 500;
      if (!isOverlayOpen()) {
        openOverlayWithView(null);
      }
      navStack.push({ view: currentViewName, params: {} });
      currentViewName = "extension-popup";
      // viewType: null so the hosted browser presents as a popout window
      // (no `webextension-view-type` attribute) — see createBrowserElement
      // for the reasoning. The icon-strip path stays at the default "popup".
      morphToView("extension-popup", { popupUrl, extensionId: resolved.id, viewType: null });
    }

    // Two-condition filter: features must look popup-style AND the args
    // array's first entry must be an nsISupportsString containing a
    // moz-extension URL. Any inspection error returns null (pass through).
    function detectExtensionPopupCall(features, args) {
      if (!features || typeof features !== "string") return null;
      if (!/\bdialog\b|\bpopup\b/i.test(features)) return null;
      try {
        if (!args || typeof args.queryElementAt !== "function") return null;
        const first = args.queryElementAt(0, Ci.nsISupportsString);
        const url = first && first.data;
        if (typeof url === "string" && url.startsWith("moz-extension://")) {
          return url;
        }
      } catch (e) {}
      return null;
    }

    // Phantom Window returned to the caller when we intercept. A Proxy
    // that swallows unknown property accesses with sensible defaults so
    // ext-windows.js's downstream chain (.gBrowser.selectedBrowser etc.)
    // doesn't crash on null. close() routes to our overlay dismissal.
    function makePhantomPopupWindow() {
      const stub = { closed: false, document: { title: "" } };
      const handler = {
        get(t, p) {
          if (p in t) return t[p];
          if (p === "close") return () => { stub.closed = true; destroyOverlay(); };
          if (p === "focus" || p === "blur") return () => {};
          if (p === "addEventListener" || p === "removeEventListener") return () => {};
          if (p === "gBrowser" || p === "selectedBrowser" || p === "contentWindow") return proxy;
          if (p === Symbol.toPrimitive) return () => "[phantom-extension-popup-window]";
          return undefined;
        },
      };
      const proxy = new Proxy(stub, handler);
      return proxy;
    }

    // Default to enabled; background.js calls setExtensionPopupIntercept()
    // with the persisted setting value shortly after api init, so any window
    // openings between init and that first push (rare in practice) match
    // the default-on behavior the user configured.
    let interceptEnabled = true;
    // Default matches STORAGE_DEFAULTS.skipOverlayAnimations (false —
    // animations on). Background pushes the persisted value via
    // setSkipOverlayAnimations after init. Used by createOverlay's
    // reveal path and destroyOverlay's dismiss path.
    let skipOverlayAnimations = false;
    // Default matches STORAGE_DEFAULTS.dimBackdrop (true). When false,
    // the overlay backdrop is transparent — the underlying page stays
    // fully visible behind the panel. Background pushes the persisted
    // value via setDimBackdrop after init.
    let dimBackdrop = true;
    function overlayBackdropColor() {
      return dimBackdrop ? "rgba(0, 0, 0, 0.25)" : "transparent";
    }
    // Services.ww.openWindow is non-writable/non-configurable on the XPCOM
    // wrapper, so direct assignment is silently rejected and defineProperty
    // throws. We replace Services.ww itself with a Proxy on an empty target
    // — the empty target dodges the Proxy invariant for non-writable own
    // properties, and the get trap returns our wrapped openWindow while
    // delegating everything else (registerNotification, getWindowEnumerator,
    // setWindowCreator, …) to the original service.
    const origWw = Services.ww;
    const origOpenWindow = origWw.openWindow.bind(origWw);
    const wrappedOpenWindow = function(parent, urlOrNull, name, features, args) {
      if (interceptEnabled) {
        const popupUrl = detectExtensionPopupCall(features, args);
        if (popupUrl) {
          openExtensionPopupByUrl(popupUrl).catch(() => {});
          return makePhantomPopupWindow();
        }
      }
      return origOpenWindow(parent, urlOrNull, name, features, args);
    };
    try {
      const wwProxy = new Proxy(Object.create(null), {
        get(_t, p) {
          if (p === "openWindow") return wrappedOpenWindow;
          const v = origWw[p];
          return typeof v === "function" ? v.bind(origWw) : v;
        },
        has(_t, p) { return p in origWw; },
      });
      Object.defineProperty(Services, "ww", { value: wwProxy, configurable: true, writable: true });
      context.callOnClose({
        close() {
          try {
            Object.defineProperty(Services, "ww", { value: origWw, configurable: true, writable: true });
          } catch (e) {}
        },
      });
    } catch (e) {
      // If we can't replace Services.ww in this Firefox build, the
      // interception is silently disabled. The setting will appear
      // checked but have no effect — better than crashing the addon.
    }

    // Build the overlay DOM hidden. The chord engine calls this to
    // prerender during its wait window; openOverlayWithView and
    // showPalette call it for immediate opens. Either way the caller
    // flips the visibility on via revealOverlay() (or, if the chord
    // cancels, tears the prerender down via destroyOverlay()).
    function createOverlay(view, params) {
      const w = getWin();
      if (!w) return null;

      // Warm popup: an overlay already exists from extension init (or from
      // a previous chord chain that hid instead of removed). Take the
      // rearm path — popup browser stays loaded, we just reset its state
      // and (re)arm pendingReveal for the next chord arm.
      const existing = w.document.getElementById(OVERLAY_ID);
      if (existing) {
        const existingBrowser = w.document.getElementById(BROWSER_ID);
        if (browserMessageManager(existingBrowser) && browserHasCurrentGeneration(existingBrowser)) {
          return rearmExistingOverlay(view, params, existing);
        }
        existing.remove();
      }

      // Each overlay gets its own instance number. The popup reads it from
      // its URL (?inst=N) and includes it in POPUP_READY. Lets chrome
      // ignore POPUP_READY from a popup that has since been destroyed
      // (prerender-swap case) — otherwise the stale POPUP_READY drains
      // the bridge buffer meant for the new popup, eating the chord-chain
      // digits the user typed.
      popupInstance++;
      // A new popup is being constructed — any reveal-block from the
      // previous destroy is no longer relevant.
      revealBlocked = false;

      // Always refresh contents so CSS changes take effect on the next
      // open after an extension reload (otherwise the cached <style> from
      // the previous load wins and code edits go unnoticed).
      let animStyle = w.document.getElementById("zen-tabs-panel-anim-styles");
      if (!animStyle) {
        animStyle = w.document.createElement("style");
        animStyle.id = "zen-tabs-panel-anim-styles";
        w.document.documentElement.appendChild(animStyle);
      }
      animStyle.textContent = `
          @keyframes ztt-overlay-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes ztt-panel-in {
            0%   { opacity: 0; transform: scale(0); }
            25%  { opacity: 1; }
            100% { opacity: 1; transform: scale(1); }
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

      let previewStyle = w.document.getElementById("zen-tabs-panel-preview-styles");
      if (!previewStyle) {
        previewStyle = w.document.createElement("style");
        previewStyle.id = "zen-tabs-panel-preview-styles";
        w.document.documentElement.appendChild(previewStyle);
      }
      previewStyle.textContent = `
          .tabbrowser-tab[zen-tabs-panel-preview] .tab-stack {
            outline: 3px solid color-mix(in srgb, var(--zen-primary-color, AccentColor), white 60%) !important;
            outline-offset: -3px;
            border-radius: 10px;
          }
        `;

      const viewName = view || "actions";
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
        "background: " + overlayBackdropColor(),
        // Start visually hidden but still paint-eligible. A remote XUL
        // browser may not reliably reach the popup ready/drain path while
        // an ancestor is visibility:hidden; opacity:0 keeps it invisible
        // to the user without starving the content process.
        // Reveal animations are applied in pendingReveal below — both
        // backdrop and panel start their fades together so the dim
        // doesn't appear ahead of the panel.
        "visibility: visible",
        "opacity: 0",
        "pointer-events: none",
      ].join(";");

      const panel = w.document.createElement("div");
      panel.id = PANEL_ID;
      panel.style.cssText = [
        "width: " + size.width + "px",
        "height: " + size.height + "px",
        "background: var(--arrowpanel-background, light-dark(rgb(244, 244, 244), rgb(31, 31, 31)))",
        "border-radius: 12px",
        "border: 1px solid var(--zen-colors-border, light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.08)))",
        "box-shadow: 0 0 9.73px rgba(0, 0, 0, 0.25), 0 24px 60px rgba(0, 0, 0, 0.4)",
        "overflow: hidden",
        "display: flex",
        "flex-direction: column",
        "transition: width 0.15s ease-out, height 0.15s ease-out",
      ].join(";");

      const br = createBrowserElement(w, size, { view, params });
      panel.appendChild(br);
      overlay.appendChild(panel);

      overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) {
          destroyOverlay();
        }
      });

      w.document.documentElement.appendChild(overlay);
      scheduleBrowserLoadKicks(w, br);

      const reveal = () => {
        if (pendingReveal !== reveal) return;
        pendingReveal = null;
        overlay.style.visibility = "visible";
        overlay.style.opacity = "1";
        overlay.style.pointerEvents = "auto";
        if (!skipOverlayAnimations) {
          overlay.style.animation = "ztt-overlay-in 0.10s ease-out";
          panel.style.animation = "ztt-panel-in 0.10s cubic-bezier(0.25, 1, 0.5, 1)";
        }
        br.focus();
      };
      pendingReveal = reveal;

      return overlay;
    }

    function createFreshOverlayForDirectOpen(view, params) {
      const w = getWin();
      const existing = w && w.document.getElementById(OVERLAY_ID);
      if (existing) {
        destroyOverlay({ hard: true, silent: true });
      }
      return createOverlay(view, params);
    }

    function focusSelectedTabBrowser() {
      const w = getWin();
      try { w && w.gBrowser && w.gBrowser.selectedBrowser && w.gBrowser.selectedBrowser.focus(); } catch (e) {}
    }

    // Warm popup is mounted from a previous chord chain (or initial
    // pre-create at extension load). Reset state for a fresh chord arm,
    // tell the popup to navigate to the requested view, and arm a new
    // pendingReveal. The popup's WarmRearm handler completes the reset
    // asynchronously and sends POPUP_READY when it's ready to drain any
    // chord-chain keys that arrived in the rearm window.
    function rearmExistingOverlay(view, params, overlay) {
      const w = getWin();
      // popupInstance intentionally NOT bumped on rearm. With the warm
      // popup, the same browser persists across chord chains — there is
      // no destroyed popup that could send a stale POPUP_READY. Overlapping
      // rearms (a second arm landing while the first's handler is still
      // running) are discriminated by the popup-side warmRearmGen counter,
      // which doesn't depend on inst. Bumping inst here would race the
      // initial popup-load IIFE (which uses the URL's ?inst=N) and orphan
      // the popup with chordBridgeReady=false if the user chords during
      // extension load.
      revealBlocked = false;
      // Popup will signal ready again after it processes WarmRearm; any
      // chord-chain keys that land in this window are buffered (just like
      // the cold-create case).
      popupReady = false;
      navStack = [];
      currentViewName = view || "actions";

      const viewName = view || "actions";
      const panel = w.document.getElementById(PANEL_ID);
      const br = w.document.getElementById(BROWSER_ID);
      const idleHidden = overlay.style.visibility === "hidden" && !pendingReveal;

      // Intentionally NOT resizing panel here. The popup has been alive
      // (and at its last measured size) since extension startup;
      // resetting to the preset 604 would cause a visible jump back-up
      // when reveal animates, and a redundant shrink once WarmRearm
      // re-renders and remeasures. handleWarmRearm sends a resize after
      // its view handler runs — the size catches up there for view
      // changes (cmd+.,o swapping to reorder, etc.). For same-view
      // rearms (cmd+. → actions → cmd+. → actions) the size is already
      // correct, no transition.
      //
      // Suppress the panel's width/height CSS transition during the
      // rearm → reveal window though: any resize that WarmRearm
      // triggers should snap to the final size before reveal, so the
      // user doesn't see the panel "grow" into place after opening.
      // The reveal closure below restores the transition so in-popup
      // sub-menu navigation still animates smoothly.
      if (panel) {
        panel.style.animation = "";
        panel.style.transition = "none";
      }
      overlay.style.animation = "";
      overlay.style.visibility = "visible";
      overlay.style.opacity = "0";
      overlay.style.pointerEvents = "none";
      delete overlay.dataset.closing;

      const reveal = () => {
        if (pendingReveal !== reveal) return;
        pendingReveal = null;
        overlay.style.visibility = "visible";
        overlay.style.opacity = "1";
        overlay.style.pointerEvents = "auto";
        if (!skipOverlayAnimations) {
          overlay.style.animation = "ztt-overlay-in 0.10s ease-out";
          if (panel) panel.style.animation = "ztt-panel-in 0.10s cubic-bezier(0.25, 1, 0.5, 1)";
        }
        // Restore the width/height transition that rearm suppressed —
        // in-popup sub-menu navigation still wants the smooth resize.
        // Defer one frame so any final size assignment from the rearm
        // window definitively snaps without interpolation.
        if (panel) {
          const w2 = getWin();
          if (w2) w2.requestAnimationFrame(() => {
            panel.style.transition = "width 0.15s ease-out, height 0.15s ease-out";
          });
        }
        if (br) br.focus();
      };
      pendingReveal = reveal;

      // Generation-tagged so stale frame scripts (from prior extension
      // loads) ignore it and only the current popup-process listener
      // forwards it to the Svelte bridge module. Assign pendingReveal before
      // sending: very small views can resize and signal ready in the same
      // turn as this message, and deferred explicit opens need a reveal
      // closure available when that happens.
      const mm = browserMessageManager(br);
      if (idleHidden && viewName === "actions" && paletteURLView(br) !== "actions") {
        try {
          br.setAttribute("src", getPaletteURL(null, params || null));
          scheduleBrowserLoadKicks(w, br);
        } catch (e) {}
      }
      if (mm) {
        try {
          mm.sendAsyncMessage("ZenChord:WarmRearm:" + CHORD_GENERATION, {
            inst: popupInstance,
            view: view || null,
            params: params || null,
          });
        } catch (e) {}
      }

      return overlay;
    }

    function revealOverlay() {
      if (pendingReveal) pendingReveal();
    }

    function forceRevealOverlay() {
      const w = getWin();
      if (!w) return;
      const overlay = w.document.getElementById(OVERLAY_ID);
      const br = w.document.getElementById(BROWSER_ID);
      if (!overlay || overlay.dataset.closing) return;
      pendingReveal = null;
      overlay.style.visibility = "visible";
      overlay.style.opacity = "1";
      overlay.style.pointerEvents = "auto";
      if (br) {
        try { br.focus(); } catch (e) {}
      }
    }

    function scheduleExplicitViewReveal(view) {
      const token = ++explicitRevealToken;
      const w = getWin();
      if (!w) return;
      const targetWidth = getViewSize(view || "actions").width;
      const startedAt = Date.now();

      const tryReveal = () => {
        if (token !== explicitRevealToken) return;
        const w2 = getWin();
        if (!w2) return;
        const overlay = w2.document.getElementById(OVERLAY_ID);
        const br = w2.document.getElementById(BROWSER_ID);
        if (!overlay || overlay.dataset.closing) return;
        if (currentViewName !== (view || "actions")) return;
        if (overlay.style.visibility !== "hidden" && overlay.style.opacity !== "0") return;

        const width = Math.round(Number.parseFloat(br?.style?.width || "0"));
        if (width === targetWidth) {
          if (pendingReveal) revealOverlay();
          else forceRevealOverlay();
          return;
        }

        if (Date.now() - startedAt < 2000) {
          w2.setTimeout(tryReveal, 100);
        }
      };

      w.setTimeout(tryReveal, 350);
    }

    // Cross-fade the existing browser out and swap in a fresh one. Used for
    // extension-popup transitions where the new content lives at a
    // different URL (a foreign extension) and we have to load a new
    // browser. Our own views never call this — they reuse the existing
    // browser via resizePanelToView + an in-popup view switch, so the
    // user never sees the empty load-state of a brand-new browser.
    function morphToView(view, params) {
      const w = getWin();
      if (!w) return;
      const panel = w.document.getElementById(PANEL_ID);
      const oldBrowser = w.document.getElementById(BROWSER_ID);
      if (!panel || !oldBrowser) return;

      const gen = ++morphGeneration;
      // For extension-popup view, prefer the cached natural size from a
      // previous open so we morph straight there. For the first open
      // of a given extension we have no idea what size the popup wants,
      // so we leave the panel at its previous size and let
      // wireForeignPopupResizing transition it once the body reports
      // (the browser inside is opacity:0 during this period so the
      // mismatched layout isn't visible — the user just sees one
      // smooth panel resize after the popup loads).
      const cachedSize = view === "extension-popup" && params?.extensionId
        ? extensionPopupSizeCache[params.extensionId]
        : null;
      const targetSize = cachedSize || getViewSize(view);
      const skipPanelResize = view === "extension-popup" && !cachedSize;

      oldBrowser.style.transition = "opacity 0.08s ease-out";
      oldBrowser.style.opacity = "0";

      w.setTimeout(() => {
        if (gen !== morphGeneration) return;

        if (!skipPanelResize) {
          panel.style.width = targetSize.width + "px";
          panel.style.height = targetSize.height + "px";
        }

        let newBr;
        if (view === "extension-popup" && params?.popupUrl) {
          newBr = createBrowserElement(w, targetSize, {
            src: params.popupUrl,
            remoteType: "extension",
            // params.viewType is null for windows.create intercepts so the
            // hosted browser mimics a real popout (no webextension-view-type
            // attribute → not registered as a popup view → extensions that
            // gate UI on getViews({type:"popup"}) treat us as popout).
            // Falls back to "popup" for icon-strip clicks.
            viewType: "viewType" in (params || {}) ? params.viewType : "popup",
          });
        } else {
          newBr = createBrowserElement(w, targetSize, {
            view: view === "actions" ? null : view,
            params: params || {},
          });
        }
        newBr.style.opacity = "0";

        oldBrowser.remove();
        panel.appendChild(newBr);
        scheduleBrowserLoadKicks(w, newBr);

        if (view === "extension-popup") {
          wireForeignPopupResizing(newBr, panel, gen, params?.extensionId);
          wireForeignPopupAutoClose(newBr);
        }

        w.setTimeout(() => {
          if (gen !== morphGeneration) return;
          newBr.style.transition = "opacity 0.08s ease-out";
          if (view === "extension-popup" && !isOverlayVisible()) {
            forceRevealOverlay();
          }
          newBr.style.opacity = "1";
          w.setTimeout(() => {
            if (gen !== morphGeneration) return;
            newBr.focus();
          }, 50);
        }, 160);
      }, 80);
    }

    // Resize the panel (and the browser inside it) to match the target
    // view's dimensions. Used for navigation between our own views — the
    // popup is staying in the same browser and will render the new view
    // itself, so chrome only needs to drive the size transition.
    //
    // `measuredHeight` (optional): the popup measures the natural content
    // height of the rendered view and passes it here. We cap to the
    // VIEW_SIZES[view].height (which acts as a max) so list-y views with
    // many rows stay bounded and scroll internally; short menus
    // (reorder, split, etc.) shrink to fit their content.
    function resizePanelToView(view, measuredHeight) {
      const w = getWin();
      if (!w) return;
      const panel = w.document.getElementById(PANEL_ID);
      const br = w.document.getElementById(BROWSER_ID);
      if (!panel || !br) return;
      const targetSize = getViewSize(view);
      const height = (typeof measuredHeight === "number" && measuredHeight > 0)
        ? Math.min(Math.ceil(measuredHeight), targetSize.height)
        : targetSize.height;
      panel.style.width = targetSize.width + "px";
      panel.style.height = height + "px";
      br.style.width = targetSize.width + "px";
      br.style.height = height + "px";
    }

    // Resize the panel and browser to match the popup body's natural size.
    // Foreign extension popups set their own body dimensions; without
    // this they're letterboxed or cropped inside our default 360×500.
    //
    // Measurement runs in the content process via a frame script that
    // posts dimensions back over the messageManager (Fission blocks
    // chrome from reading `br.contentDocument` directly).
    function wireForeignPopupResizing(br, panel, gen, extensionId) {
      const FOREIGN_POPUP_MAX_W = 800;
      const FOREIGN_POPUP_MAX_H = 700;
      const FOREIGN_POPUP_MIN_W = 200;
      const FOREIGN_POPUP_MIN_H = 120;
      const DEBOUNCE_MS = 500;
      const w = getWin();

      // applySize coalesces a flurry of size reports into at most two
      // visible transitions: the first one fires immediately (so the
      // popup gets sized as soon as it reports a size) and any
      // subsequent reports within DEBOUNCE_MS reset a timer. When the
      // timer fires we apply only the final size if it differs.
      //
      // This kills Bitwarden's three-step load animation: its body
      // briefly grows from 480×500 → 480×600 → 480×500 over ~1s, and
      // without debounce the panel visibly wobbles through each.
      let currentSize = null;
      let pendingSize = null;
      let debounceTimer = null;
      const apply = (cw, ch) => {
        panel.style.width = cw + "px";
        panel.style.height = ch + "px";
        br.style.width = cw + "px";
        br.style.height = ch + "px";
        currentSize = { w: cw, h: ch };
        if (extensionId) extensionPopupSizeCache[extensionId] = { width: cw, height: ch };
      };
      const flush = () => {
        debounceTimer = null;
        if (gen !== morphGeneration) return;
        if (pendingSize && currentSize &&
            (pendingSize.w !== currentSize.w || pendingSize.h !== currentSize.h)) {
          apply(pendingSize.w, pendingSize.h);
        }
        pendingSize = null;
      };
      const applySize = (rawW, rawH) => {
        if (gen !== morphGeneration) return;
        const cw = Math.max(FOREIGN_POPUP_MIN_W, Math.min(FOREIGN_POPUP_MAX_W, rawW || 0));
        const ch = Math.max(FOREIGN_POPUP_MIN_H, Math.min(FOREIGN_POPUP_MAX_H, rawH || 0));
        if (!cw || !ch) return;
        pendingSize = { w: cw, h: ch };
        if (!currentSize) {
          apply(cw, ch);
        }
        if (debounceTimer) w.clearTimeout(debounceTimer);
        debounceTimer = w.setTimeout(flush, DEBOUNCE_MS);
      };

      // The frame script does double duty:
      //   1. Reports body size back over the messageManager so the
      //      panel/browser get sized to the foreign popup's natural
      //      dimensions (body.scrollWidth wins over documentElement —
      //      documentElement just echoes the iframe's current width,
      //      which would prevent popups smaller than our default from
      //      shrinking).
      //   2. Listens for Esc inside the content process and posts an
      //      "ztt:popup-escape" message so the chrome side can dismiss
      //      the overlay. A chrome-window keydown listener can't see
      //      this because Fission keeps content keystrokes in the
      //      content process — the parent only gets what we forward.
      const SCRIPT_BODY =
        '(()=>{const sizeInstalled="__zenTabsPanelHostedPopupSizing";' +
        'const escapeInstalled="__zenTabsPanelHostedPopupEscape";const send=()=>{' +
        'const d=content.document;const b=d.body;const r=d.documentElement;' +
        'let w,h;if(b&&b.scrollWidth){w=b.scrollWidth;h=b.scrollHeight;}' +
        'else if(r){w=r.scrollWidth;h=r.scrollHeight;}' +
        'if(!w||!h)return;sendAsyncMessage("ztt:popup-size",{w,h});};' +
        'const observe=()=>{const b=content.document.body;if(!b)return false;' +
        'try{const ro=new content.ResizeObserver(send);ro.observe(b);' +
        'ro.observe(content.document.documentElement);}catch(e){}return true;};' +
        'if(!content[sizeInstalled]){content[sizeInstalled]=true;' +
        'if(!observe())content.addEventListener("DOMContentLoaded",observe,{once:true});}' +
        'if(!content[escapeInstalled]){content[escapeInstalled]=true;' +
        'const onKey=(e)=>{if(e.key==="Escape"){' +
        'try{e.preventDefault();e.stopPropagation();}catch(_){}' +
        'sendAsyncMessage("ztt:popup-escape",{});}};' +
        'try{content.addEventListener("keydown",onKey,{capture:true,mozSystemGroup:true});}catch(_){ }' +
        'content.addEventListener("keydown",onKey,true);}' +
        'send();' +
        '})();';

      // Load the measurement script as soon as the foreign popup's
      // content has finished loading. Earlier timing (sync after
      // appendChild, or at XULFrameLoaderCreated) drops the load on
      // the floor while the remoteType=extension process switch is
      // mid-flight. A webProgress listener at STATE_STOP fires exactly
      // once when the popup document is interactive — typically
      // 50–150ms after morph, vs the previous 500ms blind setTimeout.
      const Ci = Components.interfaces;
      const STATE_STOP_DOC =
        Ci.nsIWebProgressListener.STATE_STOP |
        Ci.nsIWebProgressListener.STATE_IS_WINDOW;
      let gotFirstSize = false;
      const armedMessageManagers = new WeakSet();
      const arm = () => {
        if (gen !== morphGeneration) return;
        const mm = browserMessageManager(br);
        if (!mm) return;
        if (!armedMessageManagers.has(mm)) {
          armedMessageManagers.add(mm);
          mm.addMessageListener("ztt:popup-size", (m) => {
            const d = m.data || {};
            if (d.w && d.h) {
              gotFirstSize = true;
              applySize(d.w, d.h);
            }
          });
          mm.addMessageListener("ztt:popup-escape", () => {
            if (gen !== morphGeneration) return;
            destroyOverlay();
          });
        }
        // Remote extension browsers can swap message managers while their
        // process remoteness settles. A one-shot loadFrameScript can land on
        // the pre-switch manager and disappear; retry until the loaded page
        // actually reports a size.
        mm.loadFrameScript("data:application/javascript," + encodeURIComponent(SCRIPT_BODY), false);
      };
      const progressListener = {
        QueryInterface: ChromeUtils.generateQI([
          "nsIWebProgressListener",
          "nsISupportsWeakReference",
        ]),
        onStateChange(_progress, _request, flag) {
          if ((flag & STATE_STOP_DOC) !== STATE_STOP_DOC) return;
          try { br.removeProgressListener(progressListener); } catch (e) {}
          arm();
        },
        onLocationChange() {}, onProgressChange() {},
        onStatusChange() {}, onSecurityChange() {}, onContentBlockingEvent() {},
      };
      try {
        br.addProgressListener(progressListener, Ci.nsIWebProgress.NOTIFY_STATE_NETWORK);
      } catch (e) {}
      // Belt-and-suspenders: if the progress listener fires against an early
      // remote-type transition, or never fires, keep retrying briefly against
      // the current message manager until the foreign popup reports its
      // natural size. This also restores Esc forwarding, which lives in the
      // same frame script.
      for (const delay of [80, 200, 500, 800, 1200, 1800]) {
        w.setTimeout(() => {
          if (!gotFirstSize) arm();
        }, delay);
      }
    }

    // Many popups dismiss themselves via window.close(). Watch for that
    // signal on our hosted browser's content window and tear down the
    // overlay in response — except during a windows.create intercept,
    // where the calling popup also closes itself as part of its
    // pop-out handoff and we want the overlay to stay open through
    // the morph instead of being dismissed.
    let suppressAutoCloseUntil = 0;
    function wireForeignPopupAutoClose(br) {
      br.addEventListener("DOMWindowClose", (e) => {
        e.preventDefault();
        if (Date.now() < suppressAutoCloseUntil) return;
        destroyOverlay();
      }, { capture: true });
    }

    // Send a WarmRearm to the popup telling it to navigate back to
    // actions and re-render. Used by destroyOverlay's soft-hide so the
    // dismissed popup settles at actions size + content while still
    // hidden, ready for the next cmd+. to reveal without any reflow.
    //
    // The popup's normal WarmRearm handler runs: state reset, view
    // handler, requestPanelResize, POPUP_READY exchange. Chrome's
    // takeChordBridgeBuffer sets popupReady=true but doesn't reveal
    // here (pendingReveal is null after destroy; revealDeferred wasn't
    // set), so this is purely state preparation.
    function resetWarmPopupToActions() {
      const w = getWin();
      const br = w && w.document.getElementById(BROWSER_ID);
      const mm = browserMessageManager(br);
      if (!mm) return;
      navStack = [];
      currentViewName = "actions";
      popupReady = false;
      if (paletteURLView(br) !== "actions") {
        try {
          br.setAttribute("src", getPaletteURL(null, null));
          scheduleBrowserLoadKicks(w, br);
        } catch (e) {}
        return;
      }
      try {
        mm.sendAsyncMessage("ZenChord:WarmRearm:" + CHORD_GENERATION, {
          inst: popupInstance,
          view: null,
          params: null,
        });
      } catch (e) {}
    }

    function destroyOverlay(opts) {
      clearPreviewState();
      const w = getWin();
      if (!w) return;
      const overlay = w.document.getElementById(OVERLAY_ID);
      if (!overlay || overlay.dataset.closing) return;

      // The popup arms its own reveal-on-pause timer on every keydown
      // (see armPopupRevealTimer in keyboard.js). With the warm popup
      // there's no pagehide to auto-clear that timer when we soft-hide,
      // so a stale timer from the now-dismissed menu would fire ~350ms
      // later, race past revealBlocked once the next chord arm clears
      // it, and re-reveal the just-armed popup at the wrong moment.
      // Tell the popup to clear its timer right now.
      const _br = w.document.getElementById(BROWSER_ID);
      const cancelMm = browserMessageManager(_br);
      if (cancelMm) {
        try { cancelMm.sendAsyncMessage("ZenChord:CancelReveal:" + CHORD_GENERATION, {}); } catch (e) {}
      }

      // `hard: true` actually removes the overlay DOM (only used during
      // extension teardown). Default is soft-hide: the warm popup browser
      // stays mounted so the next chord arm reveals instantly.
      const hard = !!(opts && opts.hard);
      const silent = !!(opts && opts.silent);

      // Block reveal until the next createOverlay. The popup's own
      // reveal timer (set in keyboard.js's dispatchKey) can fire shortly
      // after a terminal action's sendMessage, while this destroy is
      // still in flight — without this block, revealPalette would see
      // pendingReveal still set and unhide the overlay right before we
      // remove it, producing a flash.
      revealBlocked = true;
      explicitRevealToken++;

      // Bridge mode can't outlive the chord chain it was driving. If a
      // bridge is active when the overlay is being destroyed, tear it down
      // now — otherwise the engine that owned the bridge would keep
      // capturing keys until the safety timeout.
      //
      // EXCEPT during a "silent" destroy (used by enterBridgeFromOpenView
      // when swapping the prerender's view mid-chord). In that case the
      // bridge state was JUST set up by the caller and we want to keep it.
      if (bridgeBuffer && !silent) {
        bridgeBuffer = null;
        pendingStateSnapshot = null;
        finishBridge();
      }

      morphGeneration++;
      navStack = [];
      currentViewName = null;

      // Prerender that never revealed (chord cancelled, action fired, view
      // mismatch on timeout). Usually the overlay is invisible — skip the
      // exit animation. But it can ALSO be visible here, if a stale
      // popup-side reveal-on-pause timer fired between an earlier
      // destroy and this one's rearm (the race that left the menu stuck
      // open on the second cmd+.,p). In that case still force-hide.
      if (pendingReveal) {
        pendingReveal = null;
        if (hard) {
          overlay.remove();
          focusSelectedTabBrowser();
        } else if (overlay.style.visibility !== "hidden") {
          const panel = w.document.getElementById(PANEL_ID);
          overlay.style.visibility = "hidden";
          overlay.style.opacity = "0";
          overlay.style.pointerEvents = "none";
          overlay.style.animation = "";
          if (panel) panel.style.animation = "";
          focusSelectedTabBrowser();
        }
        return;
      }

      // Idle warm overlay (between chord chains, no pendingReveal). Nothing
      // to animate. Hard mode removes the DOM; soft mode is a no-op.
      if (overlay.style.visibility === "hidden") {
        if (hard) overlay.remove();
        focusSelectedTabBrowser();
        return;
      }

      // Same skip-animation path as above for opted-out users runs `finish`
      // synchronously, including the reset-to-actions handoff below.

      overlay.dataset.closing = "true";
      const panel = w.document.getElementById(PANEL_ID);

      const finish = () => {
        if (hard) {
          if (overlay.isConnected) overlay.remove();
          focusSelectedTabBrowser();
          return;
        }
        overlay.style.visibility = "hidden";
        overlay.style.opacity = "0";
        overlay.style.pointerEvents = "none";
        overlay.style.animation = "";
        if (panel) panel.style.animation = "";
        delete overlay.dataset.closing;
        focusSelectedTabBrowser();
        // Tell the popup to navigate back to the default actions view
        // and re-render at its natural size while still hidden. Without
        // this, dismissing from a smaller submenu (e.g. reorder ~230px)
        // leaves the popup's content laid out for that viewport — the
        // next cmd+. has to reflow content from reorder-shape to
        // actions-shape as the panel grows, which the user sees as the
        // contents "animating in." Resetting to actions here keeps the
        // popup pre-rendered and pre-sized for the most common
        // next-open case.
        resetWarmPopupToActions();
      };

      if (skipOverlayAnimations) {
        // Setting opted out — skip the exit animation entirely.
        finish();
        return;
      }
      overlay.style.animation = "ztt-overlay-out 0.06s ease-in forwards";
      if (panel) panel.style.animation = "ztt-panel-out 0.06s ease-in forwards";

      overlay.addEventListener("animationend", finish, { once: true });
      // Backup: if animationend doesn't fire (we've observed this when
      // destroyOverlay is invoked from a messageManager callback while
      // the parent process is busy — the animation property is set but
      // the animation never progresses), finish after the animation's
      // nominal duration.
      w.setTimeout(() => {
        if (overlay.dataset.closing) finish();
      }, 80);
    }

    function isOverlayOpen() {
      const w = getWin();
      if (!w) return false;
      const overlay = w.document.getElementById(OVERLAY_ID);
      // Mounted and reachable: the warm-popup model keeps the overlay DOM
      // around between chord chains (hidden), so navigation/state-query
      // callers should still operate on it. Visibility is checked
      // separately by isOverlayVisible() for the showPalette toggle.
      return !!overlay && !overlay.dataset.closing;
    }

    // True only when the overlay is actually shown to the user — used by
    // the toolbar-icon toggle, which should close-on-second-click only
    // when the user can see the palette (a still-hidden prerender from
    // an in-flight chord doesn't count).
    function isOverlayVisible() {
      const w = getWin();
      if (!w) return false;
      const overlay = w.document.getElementById(OVERLAY_ID);
      if (!overlay || overlay.dataset.closing) return false;
      if (pendingReveal) return false;
      return overlay.style.visibility !== "hidden" && overlay.style.opacity !== "0";
    }

    // -----------------------------------------------------------------------
    // Chord engine wiring — dual autonomous instances
    // -----------------------------------------------------------------------
    //
    // We instantiate the same shared/chord-engine.js state machine TWICE:
    // once in this chrome process (handles keys delivered to chrome targets
    // like the URL bar) and once per content process (handles keys
    // delivered to content documents). Each engine has its own local state.
    // Both are armed in parallel by armChord (a commands.onCommand for any
    // of the open-palette shortcuts triggers it). When either engine fires
    // a terminal/transition event, the other is reset via cross-process
    // IPC so its stale root timer can't pop a menu after the action.
    //
    // Partitioning is by `e.target`:
    //   - Chrome engine: filterEvent rejects events whose target is a
    //     <browser> element (those are content's responsibility).
    //   - Content engine: only sees keys delivered to its own document.
    //
    // This dual-engine design preserves chord-from-URL-bar (chrome engine)
    // and races NOWHERE for the leak case (content engine runs synchronously
    // in the content process that's about to dispatch the keystroke to the
    // editor). The leak comes from cross-process state projection; we no
    // longer project state across the boundary, so there is no race.
    //
    // See CHORD_LEAK_HANDOFF.md for the full investigation log.

    // Pre-declared so functions defined earlier (destroyOverlay, etc.) can
    // call into the engine for state queries.
    let paletteRequestFire = null;

    function debugChordTrace(type, data) {
      const w = getWin();
      if (!w || !w.__zenTabsPanelTraceEnabled) return;
      if (!Array.isArray(w.__zenTabsPanelTrace)) w.__zenTabsPanelTrace = [];
      w.__zenTabsPanelTrace.push(Object.assign({ at: Date.now(), type }, data || {}));
    }

    // Rearm-and-reveal helper. The warm popup is already mounted, so this
    // resolves to a rearm to the requested view followed by an immediate
    // reveal. Used by paths that bypass the chord-wait reveal timer
    // (toolbar-icon clicks, engine root/prefix timeout when prerender
    // is at the wrong view, etc.).
    function openOverlayWithView(view) {
      createOverlay(view || null, null);
      revealOverlay();
    }

    // Engine descended into a prefix node — eagerly prerender the prefix's
    // view (the one that would open on prefix-timeout) so it's loaded by
    // the time the timer fires. Without this, cmd+., o pauses for the
    // prefix timeout AND THEN starts the popup load + reveal, which feels
    // noticeably slower than cmd+., q (where the open-view match fires
    // the IPC immediately and popup loads during the reveal-wait window).
    function prerenderPrefixView(snapshot) {
      if (!Array.isArray(snapshot) || snapshot.length === 0) return;
      let node = CHORD_TREE;
      for (const k of snapshot) {
        if (!node || !node.children) return;
        node = node.children[k];
        if (!node) return;
      }
      if (!node || node.type !== "prefix") return;
      const view = node.onTimeout && node.onTimeout.type === "open-view"
        ? node.onTimeout.view : null;
      if (!view) return;
      // Swap the existing prerender (typically the actions-view one from
      // onArmed) for one at the prefix's view. Silent destroy preserves
      // any in-flight bridge state.
      if (pendingReveal) destroyOverlay({ silent: true });
      createOverlay(view);
    }

    // Dispatch a chord action coming from EITHER engine (chrome direct call
    // or content via the ZenChord:Action IPC). Same routing either way —
    // payload shape is { type: "action" | "switch-workspace" | "open-extension-popup", ...}.

    // The replay-last-chord action's id. Hoisted here because the
    // tracking and blocklist below reference it before the file-end
    // declaration would be reachable under TDZ rules.
    const MSG_REPLAY_LAST_CHORD = "replay-last-chord";

    // ----- Chord-replay tracking ------------------------------------------
    //
    // The chord chain has two distinct states:
    //
    //   currentChordReplay — in-flight. Populated by trackChordOpenView /
    //   trackChordBridgeKey as the engine traverses the chord chain. Reset
    //   on engine arm (every cmd+. clears it).
    //
    //   lastChordReplay — committed. The most-recent chord chain that
    //   actually FIRED A TERMINAL ACTION. cmd+.,. replays from here.
    //
    // Promotion happens only when an action terminates the chain (engine
    // action via trackChordTerminalAction, popup-fired runtime action via
    // recordReplayContext). Chord chains that just open a submenu and
    // leave the user there (cmd+.,q, then Esc) never promote — so the
    // previous chord stays replayable, matching the user's mental model
    // of "repeat the last thing I DID."
    function trackChordTerminalAction(payload) {
      if (!payload || !payload.type) return;
      if (payload.type === "action") {
        if (payload.actionId === MSG_REPLAY_LAST_CHORD) return;
        lastChordReplay = { kind: "action", actionId: payload.actionId };
      } else if (payload.type === "switch-workspace") {
        lastChordReplay = { kind: "switch-workspace", index: payload.index };
      } else if (payload.type === "open-extension-popup") {
        lastChordReplay = { kind: "open-extension-popup", extensionId: payload.extensionId };
      }
      currentChordReplay = null;
    }

    function trackChordOpenView(view) {
      // In-flight only — the chain has merely descended into a view. It's
      // not committed as replayable until an action actually fires.
      //
      // Preserve an existing open-view trace during drill navigation. For
      // example, cmd+., q, 1, 2 should replay by opening Domains and then
      // replaying "1, 2"; the intermediate domain-tabs navigate must not
      // replace the root trace with a menu-opening-only trace.
      if (currentChordReplay && currentChordReplay.kind === "open-view") return;
      currentChordReplay = { kind: "open-view", view: view || null, bridgeKeys: [] };
    }

    function replayKeyFromBridgeKey(keyData) {
      if (!keyData || typeof keyData.key !== "string" || !keyData.key) return null;
      if (keyData.key.length === 1 && /[a-z]/i.test(keyData.key)) {
        return (keyData.shiftKey ? "Shift+" : "") + keyData.key.toUpperCase();
      }
      if (keyData.shiftKey && keyData.code && /^Digit[1-9]$/.test(keyData.code)) {
        return "Shift+" + keyData.code.slice("Digit".length);
      }
      return keyData.key;
    }

    function trackChordBridgeKey(keyData) {
      const key = replayKeyFromBridgeKey(keyData);
      if (currentChordReplay && currentChordReplay.kind === "open-view" && key) {
        currentChordReplay.bridgeKeys.push(key);
      }
    }

    // Commit-on-action hook for popup-fired runtime actions. Bg calls this
    // from recordChordAction. If the chord chain involved a view open
    // (currentChordReplay.kind === "open-view"), commit the chain itself
    // so replay re-fires the navigation + bridge keys (cycling). Otherwise
    // commit the raw action (e.g. user clicked a row in the menu without
    // a chord prefix).
    //
    // Excludes its own action ids so chained replays don't recurse and
    // duplicate-prompt actions stay context-bound (not replayable).
    const REPLAY_RECORD_BLOCKLIST = new Set([
      MSG_REPLAY_LAST_CHORD,
      "duplicate-switch",
      "duplicate-open-anyway",
    ]);
    function recordReplayFromPopupAction(message) {
      if (!message || !message.type) return;
      if (REPLAY_RECORD_BLOCKLIST.has(message.type)) return;
      // Engine-fired chord actions (cmd+.,p, cmd+.,w,n, …) commit via
      // trackChordTerminalAction at chord-fire time, then paletteRequestFire
      // routes through bg's runChordAction → recordChordAction → here
      // for the *same* action. Without this skip we'd promptly overwrite
      // the engine's kind:"action" record with kind:"action-msg", and
      // replay would fall through to bg's lastChordAction (which might
      // have been overwritten by an unrelated runtime action since).
      if (lastChordReplay && lastChordReplay.kind === "action" && lastChordReplay.actionId === message.type) {
        currentChordReplay = null;
        return;
      }
      if (
        currentChordReplay &&
        currentChordReplay.kind === "open-view" &&
        Array.isArray(currentChordReplay.bridgeKeys) &&
        currentChordReplay.bridgeKeys.length > 0
      ) {
        lastChordReplay = currentChordReplay;
      } else {
        lastChordReplay = Object.assign({ kind: "action-msg" }, message);
      }
      currentChordReplay = null;
    }

    // Replay the last completed chord. Engine actions dispatch directly;
    // open-view chord chains re-enter bridge and re-forward their
    // recorded bridge keys so the popup re-fires its handlers with
    // freshly resolved data (e.g. "2nd recent" cycles through recents
    // instead of jumping back to the same tab).
    function replayLastChordTrace() {
      if (!lastChordReplay) return false;
      const r = lastChordReplay;
      if (r.kind === "action") {
        dispatchChordAction({ type: "action", actionId: r.actionId });
        return true;
      }
      if (r.kind === "switch-workspace") {
        dispatchChordAction({ type: "switch-workspace", index: r.index });
        return true;
      }
      if (r.kind === "open-extension-popup") {
        dispatchChordAction({ type: "open-extension-popup", extensionId: r.extensionId });
        return true;
      }
      if (r.kind === "open-view") {
        const keysCopy = Array.from(r.bridgeKeys || []);
        enterBridgeFromOpenView(r.view, [], "chrome", "match");
        for (const k of keysCopy) {
          forwardKeyToPopup({ key: k, code: "", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });
        }
        return true;
      }
      if (r.kind === "action-msg") {
        // Replay a popup-fired action that wasn't part of a chord chain
        // (e.g. user opened menu, clicked Reload — no chord prefix).
        // Returns false so bg falls back to its lastChordAction path
        // which re-dispatches the message through the ACTIONS table.
        return false;
      }
      return false;
    }

    function dispatchChordAction(payload) {
      if (!payload || !payload.type) return;
      trackChordTerminalAction(payload);
      if (pendingReveal) destroyOverlay();
      if (payload.type === "action") {
        if (paletteRequestFire) {
          paletteRequestFire.async({ kind: "chord-action", actionId: payload.actionId });
        }
        return;
      }
      if (payload.type === "switch-workspace") {
        const w = getWin();
        if (w?.gZenWorkspaces) {
          const list = w.gZenWorkspaces.getWorkspaces();
          const ws = Array.isArray(list) ? list[payload.index] : null;
          if (ws?.uuid) {
            try { w.gZenWorkspaces.changeWorkspaceWithID(ws.uuid); } catch (err) {}
          }
        }
        return;
      }
      if (payload.type === "open-extension-popup") {
        openExtensionPopupInternal(payload.extensionId);
        return;
      }
    }

    // Bridge entry: an engine fired open-view. Two distinct paths:
    //   source="timeout": user passively let the chord wait expire.
    //     Reveal the popup now at the requested view. Existing UX —
    //     same speed as before (root timeout fires → menu appears).
    //   source="match": user typed an explicit chord-key. Keep the popup
    //     INVISIBLE and start a reveal-on-pause timer. If the user keeps
    //     chording (more digits / drilling), the timer resets each key
    //     and UI never shows. If they pause, the timer fires and the
    //     popup is revealed at its current state.
    function enterBridgeFromOpenView(view, stateSnapshot, kind, source) {
      // Dual-engine race: chrome + content engines arm in parallel for
      // each chord arm and both run independent timers. When both fire
      // for the same open-view (typically cmd+. + pause: each engine's
      // root timer pops at ~350ms), the first one through this function
      // wins. The second's IPC arrives slightly later — silently drop it
      // so we don't destroy-and-recreate the just-revealed popup or
      // double-fire the reveal animation.
      if (bridgingEngineKind != null) return;

      // Source="match" is a user-typed chord-key (cmd+.,r, etc.) — the
      // intentional chord. Source="timeout" is the menu opening because
      // the user paused, which isn't a chord chain we want to replay
      // (replay would just pop the actions menu instead of redoing what
      // the user just did).
      if (source === "match") trackChordOpenView(view);

      bridgeBuffer = [];
      pendingStateSnapshot = stateSnapshot || [];
      bridgingEngineKind = kind;
      popupReady = false;
      const w = getWin();
      clearBridgeTimer();
      clearRevealTimer();
      bridgeTimer = w ? w.setTimeout(() => {
        bridgeTimer = null;
        finishBridge();
      }, BRIDGE_TIMEOUT_MS) : null;

      const requestedView = view || null;

      if (source === "timeout") {
        // User-paused open: reveal at the requested view. Reuse the
        // prerender if it already matches — engine root timer (no
        // requestedView, prerender is at actions) or prefix timer
        // (requestedView equals the prefix's onTimeout view, which
        // prerenderPrefixView swapped to on descent). Otherwise
        // destroy+recreate. silent destroy preserves bridge state for
        // the new popup to drain on POPUP_READY.
        const prerenderMatches = pendingReveal && (
          (!requestedView && currentViewName === "actions") ||
          (!!requestedView && currentViewName === requestedView)
        );
        if (prerenderMatches) {
          // If the popup hasn't finished rendering + measuring yet
          // (slow showActionsMenu data fetch on a tab-heavy session),
          // revealing now paints the panel at its preset preset height
          // and then a moment later requestPanelResize shrinks it,
          // producing a visible "expand-then-settle" jitter. Defer to
          // takeChordBridgeBuffer, which reveals on POPUP_READY (after
          // the resize has already been applied).
          if (!popupReady) {
            revealDeferred = true;
            scheduleDeferredRevealFallback();
          } else {
            revealOverlay();
          }
        } else {
          if (pendingReveal) destroyOverlay({ silent: true });
          openOverlayWithView(requestedView);
        }
        return;
      }

      // source === "match" (or unspecified): chord-key-driven open-view.
      // Keep popup hidden; start reveal-on-pause timer. Same silent-swap
      // requirement as above so the bridge state isn't torn down by the
      // prerender-replacement destroyOverlay.
      if (pendingReveal && !requestedView) {
        // Already prerendered at the right default view — keep it hidden.
      } else {
        if (pendingReveal) destroyOverlay({ silent: true });
        createOverlay(requestedView);
      }
      armRevealTimer();
    }

    function clearBridgeTimer() {
      const w = getWin();
      if (bridgeTimer !== null && w) {
        try { w.clearTimeout(bridgeTimer); } catch (e) {}
      }
      bridgeTimer = null;
    }

    function clearRevealTimer() {
      const w = getWin();
      if (revealTimer !== null && w) {
        try { w.clearTimeout(revealTimer); } catch (e) {}
      }
      revealTimer = null;
      // Reset any stale "fired-but-popup-wasn't-ready" flag. A new
      // chord chain starts fresh.
      revealDeferred = false;
    }

    function scheduleDeferredRevealFallback() {
      const w = getWin();
      if (!w) return;
      w.setTimeout(() => {
        if (!pendingReveal || !revealDeferred || popupReady) return;
        // If the user has already typed chord-chain keys, do not fake
        // readiness. Those keys must be delivered through the popup's real
        // POPUP_READY drain so Svelte's bridge listener is definitely
        // installed and can replay them in order.
        if (bridgeBuffer && bridgeBuffer.length > 0) {
          scheduleDeferredRevealFallback();
          return;
        }
        forcePopupBridgeReady();
        revealDeferred = false;
        revealOverlay();
      }, 250);
    }

    function forcePopupBridgeReady() {
      const drained = bridgeBuffer || [];
      bridgeBuffer = [];
      popupReady = true;

      const w = getWin();
      const br = w && w.document.getElementById(BROWSER_ID);
      const mm = browserMessageManager(br);
      if (mm) {
        try {
          mm.sendAsyncMessage(
            "ZenChord:ForceReady:" + CHORD_GENERATION,
            { buffered: drained }
          );
        } catch (e) {}
      }
    }

    function armRevealTimer() {
      const w = getWin();
      clearRevealTimer();
      if (!w) return;
      revealTimer = w.setTimeout(() => {
        revealTimer = null;
        if (!pendingReveal) return;
        // Don't reveal an empty popup. If the popup hasn't drained yet
        // we'd just paint a blank panel for a beat before the popup's
        // first view rendered (visible flash). Defer the reveal — once
        // the popup signals POPUP_READY, takeChordBridgeBuffer reveals
        // immediately if it sees a "deferred" flag set here.
        if (!popupReady) {
          revealDeferred = true;
          scheduleDeferredRevealFallback();
          return;
        }
        revealOverlay();
      }, CHORD_CONSTANTS.CHORD_REVEAL_TIMEOUT_MS || 700);
    }

    function armBufferedRevealTimer() {
      const w = getWin();
      clearRevealTimer();
      if (!w) return;
      revealTimer = w.setTimeout(() => {
        revealTimer = null;
        if (!pendingReveal || popupReady) return;
        revealOverlay();
      }, CHORD_CONSTANTS.CHORD_REVEAL_TIMEOUT_MS || 700);
    }

    // Forward a chord key to the popup's content process. If the popup
    // has signaled POPUP_READY, deliver immediately via its message
    // manager — the popup's frame-script-side ZenChord:DeliverKey listener
    // forwards typed key data into the Svelte bridge module. Before
    // POPUP_READY, queue in bridgeBuffer (drained on POPUP_READY).
    function forwardKeyToPopup(keyData) {
      // Note: don't track the bridge key here. The popup/interpreter path
      // is the authoritative replay trace path because it also catches
      // slow-typed chord chains where the engine never sees the key.
      // Tracking both here AND in the popup duplicated entries, so repeated
      // replays accumulated bogus bridgeKeys and eventually broke.
      //
      // Any chord key after the initial leader means the user is committed
      // to a chord chain — kill chrome's reveal timer so the menu doesn't
      // flash for fast chains where the action fires after the chrome
      // timer would have fired (slow popup load + drill animation).
      // From this point the popup owns the reveal-on-pause decision via
      // its own setTimeout in keyboard.js.
      clearRevealTimer();
      if (!popupReady) {
        if (bridgeBuffer) {
          bridgeBuffer.push(keyData);
          if (bridgeBuffer.length === 1) armBufferedRevealTimer();
        }
        return;
      }
      const w = getWin();
      const br = w && w.document.getElementById(BROWSER_ID);
      const mm = browserMessageManager(br);
      if (mm) {
        // Generation-tagged message name: only the frame script that
        // matches this CHORD_GENERATION receives. Stale frame scripts
        // from prior extension loads (Firefox doesn't unload them) listen
        // on their old generation's name and never fire — without this,
        // each stale script would dispatch a duplicate bridge payload
        // for every chord-chain key, producing the double-fire
        // bug (e.g. cmd+., q, 1 → drill + activate as if "1, 1").
        try { mm.sendAsyncMessage("ZenChord:DeliverKey:" + CHORD_GENERATION, keyData); } catch (e) {}
      }
    }

    // Called from takeChordBridgeBuffer when popup signals ready, or from
    // the safety timer, or from destroyOverlay if the bridge is aborted.
    function finishBridge() {
      clearBridgeTimer();
      clearRevealTimer();
      bridgeBuffer = null;
      pendingStateSnapshot = null;
      popupReady = false;
      // Tell the engine that owned the bridge to exit. Either engine's
      // exitBridge() is safe to call even when not bridging (no-op).
      if (bridgingEngineKind === "chrome" && chromeEngine) {
        try { chromeEngine.exitBridge(); } catch (e) {}
      }
      // Content engines: broadcast — any one of them might own the bridge.
      try { Services.mm.broadcastAsyncMessage("ZenChord:ExitBridge"); } catch (e) {}
      bridgingEngineKind = null;
    }

    // ---- Chrome engine instance ----------------------------------------
    function armChordFromLeader() {
      const now = Date.now();
      if (now - lastLeaderArmAt < 80) {
        debugChordTrace("arm-skip-debounce", { since: now - lastLeaderArmAt });
        return;
      }
      lastLeaderArmAt = now;
      debugChordTrace("arm-leader", {
        overlayVisible: isOverlayVisible(),
        chromeArmed: !!(chromeEngine && chromeEngine.isArmed && chromeEngine.isArmed()),
      });
      // Leader-shortcut routing while the menu is visible:
      //   - on actions   -> dismiss (toggle off).
      //   - on submenu   -> navigate back to actions (regardless of depth).
      //   - menu hidden  -> arm the chord engines.
      if (isOverlayVisible()) {
        if (!currentViewName || currentViewName === "actions") {
          debugChordTrace("arm-visible-destroy", {});
          destroyOverlay();
          return;
        }
        navStack = [];
        currentViewName = "actions";
        const w0 = getWin();
        const br0 = w0 && w0.document.getElementById(BROWSER_ID);
        const mm0 = browserMessageManager(br0);
        if (mm0) {
          try {
            mm0.sendAsyncMessage(
              "ZenChord:GoToActions:" + CHORD_GENERATION,
              {}
            );
          } catch (e) {}
        }
        return;
      }

      try { if (chromeEngine) chromeEngine.arm(); } catch (e) {}
      debugChordTrace("chrome-arm-called", {});
      const w = getWin();
      const tab = w && w.gBrowser && w.gBrowser.selectedTab;
      const br = tab && tab.linkedBrowser;
      const mm = browserMessageManager(br);
      if (mm) {
        try {
          if (contentEngineFrameScriptUrl) {
            mm.loadFrameScript(contentEngineFrameScriptUrl, false);
          }
        } catch (e) {}
        try { mm.sendAsyncMessage("ZenChord:Arm"); debugChordTrace("content-arm-sent", {}); } catch (e) {}
      }
    }

    function isDefaultLeaderShortcut(e) {
      if (!e || !e.metaKey || e.ctrlKey || e.shiftKey) return false;
      if (e.defaultPrevented) return false;
      const code = String(e.code || "");
      const key = String(e.key || "");
      return code === "Period" || key === ".";
    }

    chromeEngine = engineScope.createChordEngine({
      chordTree: CHORD_TREE,
      constants: CHORD_CONSTANTS,
      // We only handle keys delivered to chrome targets (URL bar, browser
      // chrome). Content-routed keys have target=<browser>; let the
      // per-content-process engine handle them.
      filterEvent: (e) => {
        if (e && e.__zenTabsPanelFallbackHandled) return false;
        const t = e && e.target;
        if (!t) return true;
        const name = (t.tagName || t.nodeName || "").toLowerCase();
        return name !== "browser";
      },
      setTimeoutFn: (fn, ms) => {
        const w = getWin();
        return w ? w.setTimeout(fn, ms) : null;
      },
      clearTimeoutFn: (id) => {
        const w = getWin();
        if (w && id != null) try { w.clearTimeout(id); } catch (e) {}
      },
      onArmed: () => {
        // Fresh chord arm — clear the in-flight trace so any nav/keys
        // recorded for the previous chord chain don't bleed into this
        // one. lastChordReplay (the COMMITTED previous chord) is
        // preserved for replay until something new commits over it.
        currentChordReplay = null;
        createOverlay();
      },
      // Any chrome-engine terminal/transition event resets content engines
      // that may have been armed in parallel (armChord arms both so a
      // user-customized commands shortcut works regardless of focus).
      // Without this, the content engine's stale root timer would fire
      // ~400ms later and pop an unwanted menu after a chrome-side action.
      onAction: (payload) => {
        debugChordTrace("chrome-on-action", payload);
        try { Services.mm.broadcastAsyncMessage("ZenChord:Reset"); } catch (e) {}
        dispatchChordAction(payload);
      },
      onOpenView: (view, snapshot, source) => {
        debugChordTrace("chrome-on-open-view", { view, snapshot, source });
        try { Services.mm.broadcastAsyncMessage("ZenChord:Reset"); } catch (e) {}
        enterBridgeFromOpenView(view, snapshot, "chrome", source);
      },
      onStateChange: (snapshot) => {
        debugChordTrace("chrome-on-state-change", { snapshot });
        // Chrome engine descended into a prefix. Reset content engines
        // (armed in parallel via armChord) so their stale root timers
        // don't fire ~250ms later and overwrite the prefix prerender
        // with the default actions view. Mirror of the
        // resetChromeEngineIfArmed call in onContentStateChange.
        try { Services.mm.broadcastAsyncMessage("ZenChord:Reset"); } catch (e) {}
        prerenderPrefixView(snapshot);
      },
      onCancel: () => {
        debugChordTrace("chrome-on-cancel", {});
        try { Services.mm.broadcastAsyncMessage("ZenChord:Reset"); } catch (e) {}
        if (pendingReveal) destroyOverlay();
      },
      onBridgeKey: (k) => {
        debugChordTrace("chrome-on-bridge-key", k);
        forwardKeyToPopup(k);
      },
    });

    function installChromeEngine() {
      const w = getWin();
      if (!w) return;
      chromeEngine.attach(w);

      // Intra-window focus shifts: when the user clicks between URL bar
      // and content (or vice versa) mid-chord, the chord engine that was
      // armed needs to know its domain just lost focus. The chrome
      // window's `blur` event only fires on whole-window blur, not on
      // sub-element focus shifts — so we hook `focus` events (which DO
      // bubble) and cancel chrome's engine when focus moves to a
      // <browser>. Content engines handle their own blur via their own
      // content-window blur listener.
      w.addEventListener("focus", (e) => {
        if (!chromeEngine.isArmed()) return;
        const t = e && e.target;
        if (!t) return;
        const name = (t.tagName || t.nodeName || "").toLowerCase();
        if (name === "browser" && Date.now() - lastLeaderArmAt > CHORD_CONSTANTS.CHORD_ROOT_TIMEOUT_MS) {
          debugChordTrace("chrome-reset-focus-browser", { since: Date.now() - lastLeaderArmAt });
          chromeEngine.reset();
        }
      }, true);

      const fallbackLeaderKeydown = (e) => {
        if (!isDefaultLeaderShortcut(e)) return;
        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}
        armChordFromLeader();
      };
      w.addEventListener("keydown", fallbackLeaderKeydown, { capture: true, mozSystemGroup: true });

      const hostedPopupEscapeKeydown = (e) => {
        if (e.key !== "Escape") return;
        if (currentViewName !== "extension-popup" || !isOverlayVisible()) return;
        try { e.preventDefault(); } catch (_) {}
        try { e.stopImmediatePropagation(); } catch (_) {}
        destroyOverlay();
      };
      w.addEventListener("keydown", hostedPopupEscapeKeydown, { capture: true, mozSystemGroup: true });
      w.addEventListener("keydown", hostedPopupEscapeKeydown, true);

      const fallbackChordKeydown = (e) => {
        if (!chromeEngine.isArmed()) {
          debugChordTrace("fallback-skip-not-armed", { key: e.key, target: e.target && e.target.localName });
          return;
        }
        if (e.defaultPrevented) {
          debugChordTrace("fallback-skip-default-prevented", { key: e.key });
          return;
        }
        if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e && e.target;
        const name = (t && (t.tagName || t.nodeName) || "").toLowerCase();
        if (name === "browser") {
          debugChordTrace(t && t.id === BROWSER_ID ? "fallback-skip-popup-browser" : "fallback-skip-content-browser", { key: e.key });
          return;
        }
        const chordKey = engineScope.chordKeyFor ? engineScope.chordKeyFor(e) : null;
        debugChordTrace("fallback-handle", {
          key: e.key,
          code: e.code,
          target: name,
          chordKey,
          hasRootChild: !!(chordKey && CHORD_TREE && CHORD_TREE.children && CHORD_TREE.children[chordKey]),
        });
        try { Object.defineProperty(e, "__zenTabsPanelFallbackHandled", { value: true }); } catch (_) {}
        chromeEngine.handleKey({
          key: e.key,
          code: e.code,
          shiftKey: !!e.shiftKey,
          altKey: !!e.altKey,
          ctrlKey: !!e.ctrlKey,
          metaKey: !!e.metaKey,
          isTrusted: !!e.isTrusted,
          target: name === "browser" ? null : e.target,
          preventDefault: () => { try { e.preventDefault(); } catch (_) {} },
          stopPropagation: () => { try { e.stopPropagation(); } catch (_) {} },
        });
        try { e.stopImmediatePropagation(); } catch (_) {}
      };
      w.addEventListener("keydown", fallbackChordKeydown, { capture: true });
      context.callOnClose({
        close() {
          try { w.removeEventListener("keydown", fallbackLeaderKeydown, { capture: true, mozSystemGroup: true }); } catch (e) {}
          try { w.removeEventListener("keydown", hostedPopupEscapeKeydown, { capture: true, mozSystemGroup: true }); } catch (e) {}
          try { w.removeEventListener("keydown", hostedPopupEscapeKeydown, true); } catch (e) {}
          try { w.removeEventListener("keydown", fallbackChordKeydown, { capture: true }); } catch (e) {}
        },
      });
    }

    // ---- Per-content-process frame script ------------------------------
    //
    // Loads the same shared/chord-engine.js + shared/keybindings.js +
    // shared/constants.js into the content process via Services.scriptloader
    // and instantiates an engine attached to the `content` window. The
    // engine reports actions/open-view/cancel/bridge-key back to chrome via
    // sendAsyncMessage. Re-attaches on DOMWindowCreated for navigations.
    // Skips activation when the document is moz-extension:// (our popup and
    // foreign-extension popups handle their own keys).
    function installContentEngineFrameScript() {
      if (contentEngineFrameScriptUrl) return;
      const engineURL = context.extension.getURL("shared/chord-engine.js");
      const bindingsURL = context.extension.getURL("shared/keybindings.js");
      const constantsURL = context.extension.getURL("shared/constants.js");
      // The frame-script body runs in EVERY content process. Two paths:
      //
      //   1. Non-extension pages (websites): instantiate the chord engine
      //      attached to `content`. Armed externally by ZenChord:Arm IPC
      //      (sent from chrome when a commands.onCommand for one of the
      //      open-palette shortcuts fires). Once armed, detects chord
      //      keys, fires open-view/action/cancel/bridge-key IPC to chrome.
      //      The engine is the source of truth for chord state in this
      //      process.
      //
      //   2. Extension pages (moz-extension:// — our popup and foreign-
      //      extension popups): do NOT attach the engine (their content
      //      handles its own keys via the popup runtime). But DO listen
      //      for ZenChord:* bridge messages from chrome and forward them
      //      as typed bridge payloads to the Svelte app. This is how
      //      chord-chain digits reach the popup while it's still invisible
      //      without synthesizing DOM KeyboardEvents.
      const body =
        "(function(){\n" +
        "var __GEN = " + JSON.stringify(CHORD_GENERATION) + ";\n" +
        "try {\n" +
        // Set the same-generation guard before loading any dependencies.
        // The delayed global frame script and the explicit focused-tab
        // load in armChordFromLeader can race in a fresh content process;
        // if the marker is only written after loadSubScript, both copies
        // can pass the guard and install duplicate key/action listeners.
        // Duplicate content engines make terminal actions fire twice
        // (cmd+.,p goes previous, then immediately back).
        "  if (content && content.__zenTabsPanelChordEngineGen === __GEN) return;\n" +
        "  if (content) content.__zenTabsPanelChordEngineGen = __GEN;\n" +
        "} catch(e){}\n" +
        "var __scope = {};\n" +
        "try {\n" +
        "  Services.scriptloader.loadSubScript(" + JSON.stringify(bindingsURL) + ", __scope);\n" +
        "  Services.scriptloader.loadSubScript(" + JSON.stringify(constantsURL) + ", __scope);\n" +
        "  Services.scriptloader.loadSubScript(" + JSON.stringify(engineURL) + ", __scope);\n" +
        "} catch (err) {\n" +
        "  try { if (content && content.__zenTabsPanelChordEngineGen === __GEN) content.__zenTabsPanelChordEngineGen = null; } catch(e){}\n" +
        "  return;\n" +
        "}\n" +
        "function isExtensionPage(){\n" +
        "  try { return String(content && content.location && content.location.href || '').startsWith('moz-extension://'); } catch (e) { return false; }\n" +
        "}\n" +
        "function tag(data){ var o = data || {}; o.__gen = __GEN; return o; }\n" +
        "function bridgeEvent(type, data){\n" +
        "  try {\n" +
        "    if (!isExtensionPage() || !content || !content.document) return;\n" +
        "    var payload = JSON.stringify({ type: type, data: data || {} });\n" +
        "    var ev = new content.CustomEvent('ztt:bridge-message', { detail: payload });\n" +
        "    content.document.dispatchEvent(ev);\n" +
        "  } catch(e){}\n" +
        "}\n" +
        // Typed bridge dispatch into the popup. The Svelte chord-bridge
        // module receives these payloads and feeds the same interpreter
        // queue used by real visible keydown handling.
        // Generation-tagged listener name. Only this generation's chrome
        // side sends to this name; stale frame scripts from prior loads
        // listen on their old generation's name and stay silent.
        "addMessageListener('ZenChord:DeliverKey:' + __GEN, function(m){\n" +
        "  if (__shutdown) return;\n" +
        "  bridgeEvent('deliver-key', (m && m.data) || {});\n" +
        "});\n" +
        // Warm-popup rearm: chrome tells the loaded popup to reset its UI
        // state (selection, preview, scroll), navigate to the requested
        // view, and then signal POPUP_READY to drain any chord-chain keys
        // that arrived in the rearm window. Payload is JSON-encoded so we
        // don't have to cloneInto objects across the chrome→content
        // boundary.
        "addMessageListener('ZenChord:WarmRearm:' + __GEN, function(m){\n" +
        "  if (__shutdown) return;\n" +
        "  bridgeEvent('warm-rearm', (m && m.data) || {});\n" +
        "});\n" +
        // Safety fallback for a visible popup whose POPUP_READY handshake
        // was missed. Chrome treats this like a late empty drain so live
        // menu keys stop being held behind chordBridgeReady=false.
        "addMessageListener('ZenChord:ForceReady:' + __GEN, function(m){\n" +
        "  if (__shutdown) return;\n" +
        "  bridgeEvent('force-ready', (m && m.data) || {});\n" +
        "});\n" +
        // Cancel-reveal: chrome dismisses the overlay and needs the popup
        // to drop any in-flight reveal-on-pause timer before the next
        // chord arm clears revealBlocked. Without this, the stale timer
        // fires after the next rearm and re-reveals the popup (the
        // "menu stays open after cmd+.,p" bug).
        "addMessageListener('ZenChord:CancelReveal:' + __GEN, function(){\n" +
        "  if (__shutdown) return;\n" +
        "  bridgeEvent('cancel-reveal', {});\n" +
        "});\n" +
        // Leader pressed while the menu is on a submenu → cross-fade
        // navigate back to actions. Distinct from WarmRearm (which
        // resets state and is for hidden-popup state preparation) —
        // this runs the popup's normal navigateToView so the user sees
        // the standard sub-menu transition.
        "addMessageListener('ZenChord:GoToActions:' + __GEN, function(){\n" +
        "  if (__shutdown) return;\n" +
        "  bridgeEvent('go-to-actions', {});\n" +
        "});\n" +
        // The chord-engine path runs only on non-extension pages. The popup
        // and foreign extension popups own their own keybindings.
        // Mutable constants object — chrome's setChordDelay broadcasts
        // ZenChord:SetDelay to mutate these at runtime.
        "var __constants = {\n" +
        "  CHORD_ROOT_TIMEOUT_MS: __scope.CHORD_ROOT_TIMEOUT_MS || 350,\n" +
        "  CHORD_PREFIX_TIMEOUT_MS: __scope.CHORD_PREFIX_TIMEOUT_MS || 350,\n" +
        "};\n" +
        "addMessageListener('ZenChord:SetDelay', function(m){\n" +
        "  if (__shutdown) return;\n" +
        "  var ms = m && m.data && m.data.ms;\n" +
        "  if (typeof ms === 'number' && ms >= 0) {\n" +
        "    __constants.CHORD_ROOT_TIMEOUT_MS = ms;\n" +
        "    __constants.CHORD_PREFIX_TIMEOUT_MS = ms;\n" +
        "  }\n" +
        "});\n" +
        "var __tree = __scope.buildChordTree(__scope.ZEN_KEYBINDINGS, __scope.ZEN_WORKSPACE_DIGIT_CHORDS, __constants);\n" +
        "var __engine = __scope.createChordEngine({\n" +
        "  chordTree: __tree,\n" +
        "  constants: __constants,\n" +
        "  filterEvent: function(){ return true; },\n" +
        "  setTimeoutFn: function(fn, ms){ return content ? content.setTimeout(fn, ms) : null; },\n" +
        "  clearTimeoutFn: function(id){ if (content && id != null) try { content.clearTimeout(id); } catch (e) {} },\n" +
        "  onArmed: function(){ try { sendAsyncMessage('ZenChord:Armed', tag({})); } catch(e){} },\n" +
        "  onAction: function(p){ try { sendAsyncMessage('ZenChord:Action', tag(p)); } catch(e){} },\n" +
        "  onOpenView: function(v, s, source){ try { sendAsyncMessage('ZenChord:OpenView', tag({ view: v, snapshot: s, source: source })); } catch(e){} },\n" +
        "  onCancel: function(){ try { sendAsyncMessage('ZenChord:Cancel', tag({})); } catch(e){} },\n" +
        "  onBridgeKey: function(k){ try { sendAsyncMessage('ZenChord:BridgeKey', tag(k)); } catch(e){} },\n" +
        "  onStateChange: function(snapshot){ try { sendAsyncMessage('ZenChord:StateChange', tag({ snapshot: snapshot })); } catch(e){} },\n" +
        "});\n" +
        "var __shutdown = false;\n" +
        // Default-group capture listener. The system-group engine listener
        // alone can't suppress custom page handlers (e.g. Reddit's bare-q
        // sidebar toggle): system-group preventDefault stops the default
        // browser action (character insertion) but doesn't reach
        // default-group listeners, and stopPropagation in one group
        // doesn't cross to the other. Attached at the WINDOW level in
        // default-group capture so it fires before any page listener on
        // document/body/etc.; stopPropagation here keeps the event from
        // reaching those inner nodes. Same-node system-group listeners
        // (our engine) still fire — propagation-stop only blocks travel
        // to OTHER nodes, not other listeners on the same node.
        "function blockDefaultGroup(e){\n" +
        "  if (__shutdown) return;\n" +
        "  if (!__engine.isArmed()) return;\n" +
        "  if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift') return;\n" +
        "  if (e.metaKey || e.ctrlKey || e.altKey) return;\n" +
        "  try { e.preventDefault(); } catch(_) {}\n" +
        "  try { e.stopPropagation(); } catch(_) {}\n" +
        "}\n" +
        "function attach(){\n" +
        "  try {\n" +
        "    if (__shutdown) return;\n" +
        "    if (!content) return;\n" +
        "    // Extension pages skip engine attachment — they have their own keybindings.\n" +
        "    if (isExtensionPage()) return;\n" +
        "    __engine.attach(content);\n" +
        "    // Detach-then-attach the default-group blocker so duplicate\n" +
        "    // DOMWindowCreated firings don't stack listeners.\n" +
        "    try { content.removeEventListener('keydown', blockDefaultGroup, { capture: true }); } catch(_) {}\n" +
        "    content.addEventListener('keydown', blockDefaultGroup, { capture: true });\n" +
        "  } catch (err) { /* ignore */ }\n" +
        "}\n" +
        "attach();\n" +
        "addEventListener('DOMWindowCreated', attach, true);\n" +
        "addMessageListener('ZenChord:ExitBridge', function(){ try { __engine.exitBridge(); } catch(e){} });\n" +
        "addMessageListener('ZenChord:Reset', function(){ try { __engine.reset(); } catch(e){} });\n" +
        // External-trigger arm — chrome calls this when the open-palette
        // commands shortcut fires. Sent to the focused tab's MM only.
        "addMessageListener('ZenChord:Arm', function(){\n" +
        "  if (__shutdown) return;\n" +
        "  try { __engine.arm(); } catch(e){}\n" +
        "});\n" +
        // Shutdown signal: extension reload broadcasts this. We detach the
        // engine and stop responding so a stale frame script (which Firefox
        // doesn't unload on extension reload) doesn't double-fire alongside
        // the freshly-loaded frame script in the same content process.
        "addMessageListener('ZenChord:Shutdown', function(){\n" +
        "  __shutdown = true;\n" +
        "  try { if (content && content.__zenTabsPanelChordEngineGen === __GEN) content.__zenTabsPanelChordEngineGen = null; } catch(e){}\n" +
        "  try { __engine.detach(); } catch(e){}\n" +
        "  try { content && content.removeEventListener('keydown', blockDefaultGroup, { capture: true }); } catch(e){}\n" +
        "});\n" +
        "addMessageListener('ZenChord:AddChord', function(m){\n" +
        "  try {\n" +
        "    if (__shutdown) return;\n" +
        "    var d = m && m.data;\n" +
        "    if (d && d.key && d.node && __tree && __tree.children) __tree.children[d.key] = d.node;\n" +
        "  } catch(e){}\n" +
        "});\n" +
        // Ask chrome for any dynamic chord entries that were registered
        // before this frame script loaded (e.g. Shift+1..9 extension popup
        // shortcuts added at extension startup).
        "try { sendAsyncMessage('ZenChord:Hello', tag({})); } catch(e){}\n" +
        "})();";
      const url = "data:application/javascript;charset=utf-8," + encodeURIComponent(body);
      try {
        Services.mm.loadFrameScript(url, true);
        contentEngineFrameScriptUrl = url;
      } catch (e) {}
    }

    // ---- Cross-process message handlers --------------------------------
    //
    // Each handler gates on the generation tag: frame scripts loaded by a
    // PRIOR extension load (Firefox doesn't unload them on reload) send
    // messages tagged with their old generation. Chrome only processes
    // messages tagged with the current CHORD_GENERATION; everything else
    // is silently dropped. This prevents stale engines from double-firing
    // actions alongside the current engine.
    function isCurrentGen(m) {
      const data = m && m.data;
      return data && data.__gen === CHORD_GENERATION;
    }
    // Whenever a CONTENT engine fires a chord outcome, the chrome engine
    // (if armed in parallel via armChord) is now stale — its root timer
    // would fire later and pop an unwanted menu. Reset it. The reverse
    // (chrome engine firing while content armed) is handled by content
    // engines themselves via the ZenChord:Reset broadcast.
    function resetChromeEngineIfArmed() {
      try { if (chromeEngine && chromeEngine.isArmed()) chromeEngine.reset(); } catch (e) {}
    }
    function onContentAction(m) {
      if (!isCurrentGen(m)) return;
      resetChromeEngineIfArmed();
      dispatchChordAction(m.data);
    }
    function onContentArmed(m) {
      if (!isCurrentGen(m)) return;
      // Content arm is sent asynchronously after the chrome leader path
      // arms synchronously. If the user types the first chord key before
      // that IPC arrives, chrome may already be bridging into a requested
      // view. A late content-armed prerender must not rearm the warm popup
      // back to actions and make buffered drill keys replay in the wrong
      // view.
      if (bridgingEngineKind != null) {
        debugChordTrace("content-armed-skip-bridging", {});
        return;
      }
      // Content engine just self-armed. Clear the in-flight trace
      // (same as chrome engine's onArmed) and prerender the popup
      // so it's ready if the chord chain involves a view, or if the
      // reveal timer fires (no further chord keys typed).
      currentChordReplay = null;
      createOverlay();
    }
    function onContentOpenView(m) {
      if (!isCurrentGen(m)) return;
      resetChromeEngineIfArmed();
      const data = m.data;
      enterBridgeFromOpenView(data.view, data.snapshot, "content", data.source);
    }
    function onContentCancel(m) {
      if (!isCurrentGen(m)) return;
      resetChromeEngineIfArmed();
      if (pendingReveal) destroyOverlay();
    }
    function onContentBridgeKey(m) {
      if (!isCurrentGen(m)) return;
      forwardKeyToPopup(m.data);
    }
    function onContentStateChange(m) {
      if (!isCurrentGen(m)) return;
      // Content engine descended into a prefix. The chrome engine
      // (armed in parallel via armChord) needs to be reset; otherwise
      // its 250ms root timer fires before the content engine's 300ms
      // prefix timer and pops the default actions view before the
      // intended prefix view can take over.
      resetChromeEngineIfArmed();
      const data = m.data;
      prerenderPrefixView(data && data.snapshot);
    }
    function onContentHello(m) {
      if (!isCurrentGen(m)) return;
      // A frame script just initialized; reply with the current set of
      // dynamic chord entries so it can populate its tree.
      if (!m.target || !m.target.messageManager) return;
      for (const entry of dynamicChordEntries) {
        try {
          m.target.messageManager.sendAsyncMessage("ZenChord:AddChord", entry);
        } catch (e) {}
      }
    }
    Services.mm.addMessageListener("ZenChord:Action",      onContentAction);
    Services.mm.addMessageListener("ZenChord:Armed",       onContentArmed);
    Services.mm.addMessageListener("ZenChord:OpenView",    onContentOpenView);
    Services.mm.addMessageListener("ZenChord:Cancel",      onContentCancel);
    Services.mm.addMessageListener("ZenChord:BridgeKey",   onContentBridgeKey);
    Services.mm.addMessageListener("ZenChord:StateChange", onContentStateChange);
    Services.mm.addMessageListener("ZenChord:Hello",       onContentHello);

    // Teardown helpers used by callOnClose.
    //
    // Frame scripts loaded via Services.mm.loadFrameScript persist in
    // existing content processes across extension reloads (Firefox doesn't
    // give us a way to forcibly unload them). On extension unload we
    // broadcast ZenChord:Shutdown — content-side engines listening for
    // this stop processing keys, so a stale frame script from a previous
    // extension load doesn't double-fire alongside the new code's frame
    // script. We also removeDelayedFrameScript so new content processes
    // don't load the stale script.
    // -----------------------------------------------------------------------
    // Duplicate-link indicator
    // -----------------------------------------------------------------------
    // Firefox shows the destination URL of a hovered link in the
    // statuspanel pill at the bottom of the page. When the hovered URL
    // already matches an open tab, this paints the pill orange so the
    // user can see at a glance that opening the link will produce a
    // duplicate tab.
    //
    // We hook XULBrowserWindow.setOverLink rather than observing the
    // label's `value`: the value is a display-formatted string (host
    // trimmed, protocol stripped on some surfaces), not the raw URL we
    // need for an open-tab match.
    let origSetOverLink = null;
    function installDuplicateLinkIndicator() {
      const w = getWin();
      if (!w?.document || !w.XULBrowserWindow) return;
      if (origSetOverLink) return; // already wired

      let style = w.document.getElementById("zen-tabs-panel-duplicate-link-css");
      if (!style) {
        style = w.document.createElement("style");
        style.id = "zen-tabs-panel-duplicate-link-css";
        // Inherit Zen's natural label shape/radius — only swap the
        // background and text color. A solid orange + dark text keeps
        // the pill visually consistent with the non-duplicate state
        // while making "already open" instantly recognizable.
        style.textContent = `
          #statuspanel[ztt-duplicate-link="true"] #statuspanel-label {
            background-color: #f59e0b !important;
            color: black !important;
            border-color: #d97706 !important;
          }
        `;
        w.document.documentElement.appendChild(style);
      }

      const statusPanel = w.document.getElementById("statuspanel");
      const xbw = w.XULBrowserWindow;
      origSetOverLink = xbw.setOverLink.bind(xbw);
      xbw.setOverLink = function (url, hosted) {
        try {
          let isDup = false;
          if (url && /^https?:/.test(url)) {
            for (const tab of w.gBrowser.tabs) {
              const u = tab.linkedBrowser?.currentURI?.spec || "";
              if (u === url) { isDup = true; break; }
            }
          }
          if (statusPanel) {
            if (isDup) statusPanel.setAttribute("ztt-duplicate-link", "true");
            else statusPanel.removeAttribute("ztt-duplicate-link");
          }
        } catch (e) {}
        return origSetOverLink(url, hosted);
      };
    }
    function teardownDuplicateLinkIndicator() {
      const w = getWin();
      try {
        if (origSetOverLink && w?.XULBrowserWindow) {
          w.XULBrowserWindow.setOverLink = origSetOverLink;
        }
      } catch (e) {}
      origSetOverLink = null;
      const style = w?.document?.getElementById("zen-tabs-panel-duplicate-link-css");
      if (style) style.remove();
      const statusPanel = w?.document?.getElementById("statuspanel");
      if (statusPanel) statusPanel.removeAttribute("ztt-duplicate-link");
    }

    // -----------------------------------------------------------------------
    // Duplicate-link interceptor
    // -----------------------------------------------------------------------
    // openLinkIn(url, where, params) is the single funnel for cmd+click,
    // middle-click, target=_blank, "Open Link in New Tab" context menu,
    // and same-tab link clicks (where === "current"). We hook it so that
    // any navigation about to produce a tab with a URL already open
    // elsewhere is intercepted: instead of calling the original, we pop
    // our duplicate-prompt overlay with three options.
    //
    // No tab is ever created on intercept — the prompt shows directly,
    // the user picks Switch / Open anyway / (Esc cancels), and we either
    // activate the existing duplicate, replay the saved openLinkIn args,
    // or do nothing.
    let origOpenLinkIn = null;
    let pendingDuplicate = null; // { url, where, params }
    let duplicateTabInterceptEnabled = true;

    function urlMatchesAnyOpenTab(url, excludeTab) {
      const w = getWin();
      if (!w?.gBrowser) return null;
      for (const tab of w.gBrowser.tabs) {
        if (tab === excludeTab) continue;
        const u = tab.linkedBrowser?.currentURI?.spec || "";
        if (u === url) return tab;
      }
      return null;
    }

    function browserHasCurrentGeneration(br) {
      if (!br) return false;
      const expected = "gen=" + encodeURIComponent(CHORD_GENERATION);
      try {
        const current = String(br.currentURI?.spec || "");
        if (current.includes(expected)) return true;
        // A newly-created XUL <browser> often reports about:blank while the
        // extension page is still being attached. During that window getAPI()
        // can be re-entered by popup startup messages; treating the browser
        // as stale here destroys the booting popup and creates a tight
        // about:blank/recreate loop.
        if (current === "about:blank" && String(br.getAttribute("src") || "").includes(expected)) {
          return true;
        }
      } catch (e) {}
      return false;
    }

    function installDuplicateLinkInterceptor() {
      const w = getWin();
      if (!w || origOpenLinkIn) return;
      const orig = w.openLinkIn;
      if (typeof orig !== "function") return;
      origOpenLinkIn = orig;

      w.openLinkIn = function (url, where, params) {
        try {
          if (duplicateTabInterceptEnabled &&
              url && /^https?:/.test(url) &&
              (where === "tab" || where === "tabshifted" || where === "current")) {
            const excludeTab = where === "current" ? w.gBrowser.selectedTab : null;
            const existing = urlMatchesAnyOpenTab(url, excludeTab);
            if (existing) {
              pendingDuplicate = { url, where, params, domId: existing.id };
              try {
                createOverlay("duplicate-prompt", { url, domId: existing.id });
                // Defer reveal until the popup signals POPUP_READY so the
                // panel doesn't appear at the previous view's size and
                // then jump-shrink once the duplicate-prompt's measured
                // height comes back. takeChordBridgeBuffer reveals when
                // popupReady transitions true with revealDeferred set.
                revealDeferred = true;
              } catch (e) {}
              return null;
            }
          }
        } catch (e) {}
        return origOpenLinkIn.call(this, url, where, params);
      };
    }

    function teardownDuplicateLinkInterceptor() {
      const w = getWin();
      try {
        if (origOpenLinkIn && w) w.openLinkIn = origOpenLinkIn;
      } catch (e) {}
      origOpenLinkIn = null;
      pendingDuplicate = null;
    }

    function teardownChordEngines() {
      try { if (chromeEngine) chromeEngine.detach(); } catch (e) {}
      // Hard-remove the warm overlay so its persistent popup browser
      // doesn't leak across an extension reload (soft-hide alone keeps
      // the DOM around).
      try { destroyOverlay({ hard: true }); } catch (e) {}
      try { Services.mm.broadcastAsyncMessage("ZenChord:Shutdown"); } catch (e) {}
      try { Services.mm.broadcastAsyncMessage("ZenChord:Reset"); } catch (e) {}
      // Remove every delayed chord-engine frame script we (or a prior
      // extension load) ever registered. Firefox doesn't unload frame
      // scripts from existing content processes, but at least we can
      // stop them from auto-loading into new ones. Without this, every
      // disable+enable cycle leaks a permanent stale frame script that
      // re-fires alongside the new one and corrupts chord behavior.
      try {
        const scripts = Services.mm.getDelayedFrameScripts();
        for (const entry of scripts) {
          const url = entry[0];
          if (typeof url === "string" && url.indexOf("__engine.attach") !== -1 && url.indexOf("ZenChord") !== -1) {
            try { Services.mm.removeDelayedFrameScript(url); } catch (e) {}
          }
        }
      } catch (e) {}
      contentEngineFrameScriptUrl = null;
      try { Services.mm.removeMessageListener("ZenChord:Action",    onContentAction); } catch (e) {}
      try { Services.mm.removeMessageListener("ZenChord:Armed",     onContentArmed); } catch (e) {}
      try { Services.mm.removeMessageListener("ZenChord:OpenView",  onContentOpenView); } catch (e) {}
      try { Services.mm.removeMessageListener("ZenChord:Cancel",    onContentCancel); } catch (e) {}
      try { Services.mm.removeMessageListener("ZenChord:BridgeKey",   onContentBridgeKey); } catch (e) {}
      try { Services.mm.removeMessageListener("ZenChord:StateChange", onContentStateChange); } catch (e) {}
      try { Services.mm.removeMessageListener("ZenChord:Hello",       onContentHello); } catch (e) {}
    }

    installChromeEngine();
    installContentEngineFrameScript();
    installDuplicateLinkIndicator();
    installDuplicateLinkInterceptor();

    // Pre-create the warm overlay so the popup browser loads its content
    // (popup.html, all view modules, the initial data fetches) in the
    // background. The first chord arm rearms this existing overlay rather
    // than paying a 50-200ms cold-start cost. Subsequent chord arms also
    // reuse the same loaded popup — the browser never reloads, only
    // navigates internally via WarmRearm.
    try { createOverlay(); } catch (e) {}

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
        //
        // `excludeDomIds` (optional): extra DOM ids to skip — used by
        // closeAndSelect on a multi-selection so the successor isn't one
        // of the tabs that are about to be closed.
        async goToPreviousTab(excludeDomIds) {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;

          const allTabs = getAllTabElements();
          const currentTab = w.gBrowser.selectedTab;
          const currentDomId = currentTab?.id;

          // Collect DOM IDs of tabs currently visible to the user, plus any
          // caller-specified excludes.
          const skipDomIds = new Set(Array.isArray(excludeDomIds) ? excludeDomIds : []);
          if (currentDomId) skipDomIds.add(currentDomId);

          // If current tab is in a split view, find its sibling tabs
          if (w.gZenViewSplitter?._data) {
            const currentGroup = w.gZenViewSplitter._data.find(
              (g) => g.tabs && g.tabs.some((t) => t.id === currentDomId)
            );
            if (currentGroup) {
              for (const tab of currentGroup.tabs) {
                skipDomIds.add(tab.id);
              }
            }
          }

          // Sort by lastAccessed descending, filter out visible, unread,
          // and new-tab/blank pages (the latter shouldn't anchor "previous"
          // navigation — landing in an empty workspace would otherwise
          // make the next cmd+.,p jump back into the wrong workspace).
          const candidates = allTabs
            .filter((t) => !skipDomIds.has(t.id) && !t.hasAttribute("unread") && !isNewTabElement(t))
            .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

          if (candidates.length === 0) return false;

          return activateNativeTab(candidates[0]);
        },

        // Resolve parent tab using the persisted UUID first (survives restart),
        // falling back to the runtime openerTab reference. Returns null if
        // neither is available. `excludeDomIds` skips parents/ancestors that
        // are in the about-to-close set (multi-close case).
        async goToParentTab(excludeDomIds) {
          ensureTabTracking();
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const skip = new Set(Array.isArray(excludeDomIds) ? excludeDomIds : []);
          // Walk up the parent chain to find one that survives.
          let candidate = resolveParentTab(currentTab);
          while (candidate && skip.has(candidate.id)) {
            candidate = resolveParentTab(candidate);
          }
          if (!candidate) return false;
          return activateNativeTab(candidate);
        },

        async goToNextSibling(excludeDomIds) {
          ensureTabTracking();
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const siblings = resolveSiblingTabs(currentTab);
          if (!siblings.length) return false;
          const skip = new Set(Array.isArray(excludeDomIds) ? excludeDomIds : []);
          const idx = siblings.indexOf(currentTab);
          if (idx < 0) return false;
          for (let i = idx + 1; i < siblings.length; i++) {
            if (!skip.has(siblings[i].id)) return activateNativeTab(siblings[i]);
          }
          return false;
        },

        async goToPrevSibling(excludeDomIds) {
          ensureTabTracking();
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const siblings = resolveSiblingTabs(currentTab);
          if (!siblings.length) return false;
          const skip = new Set(Array.isArray(excludeDomIds) ? excludeDomIds : []);
          const idx = siblings.indexOf(currentTab);
          if (idx <= 0) return false;
          for (let i = idx - 1; i >= 0; i--) {
            if (!skip.has(siblings[i].id)) return activateNativeTab(siblings[i]);
          }
          return false;
        },

        async goToNextVerticalTab(excludeDomIds) {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const ws = currentTab.getAttribute("zen-workspace-id");
          const sameWorkspace = getAllTabElements().filter(
            (t) => t.getAttribute("zen-workspace-id") === ws
          );
          const skip = new Set(Array.isArray(excludeDomIds) ? excludeDomIds : []);
          const idx = sameWorkspace.indexOf(currentTab);
          if (idx < 0) return false;
          for (let i = idx + 1; i < sameWorkspace.length; i++) {
            if (!skip.has(sameWorkspace[i].id)) return activateNativeTab(sameWorkspace[i]);
          }
          return false;
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

        async goToPrevVerticalTab(excludeDomIds) {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;
          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab) return false;
          const ws = currentTab.getAttribute("zen-workspace-id");
          const sameWorkspace = getAllTabElements().filter(
            (t) => t.getAttribute("zen-workspace-id") === ws
          );
          const skip = new Set(Array.isArray(excludeDomIds) ? excludeDomIds : []);
          const idx = sameWorkspace.indexOf(currentTab);
          if (idx <= 0) return false;
          for (let i = idx - 1; i >= 0; i--) {
            if (!skip.has(sameWorkspace[i].id)) return activateNativeTab(sameWorkspace[i]);
          }
          return false;
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
          // Drop essentials — they're not pinnable in the normal sense.
          const tabs = getActionTargetTabs().filter((t) => !t.hasAttribute("zen-essential"));
          if (tabs.length === 0) return false;
          // Coherent toggle for mixed selections: if anything is
          // currently unpinned, pin everything; otherwise unpin
          // everything. Matches macOS Finder's group-toggle behavior
          // and avoids the "half are pinned, half aren't" ambiguity.
          const anyUnpinned = tabs.some((t) => !t.pinned);
          for (const tab of tabs) {
            if (anyUnpinned) w.gBrowser.pinTab(tab);
            else w.gBrowser.unpinTab(tab);
          }
          return true;
        },

        async copyCurrentUrlMarkdown() {
          const tabs = getActionTargetTabs();
          if (tabs.length === 0) return false;
          const lines = [];
          for (const tab of tabs) {
            const url = tab.linkedBrowser?.currentURI?.spec || "";
            if (!url) continue;
            const title = (tab.label || "").replace(/[\[\]]/g, "");
            lines.push("[" + title + "](" + url + ")");
          }
          if (lines.length === 0) return false;
          try {
            const clip = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
            clip.copyString(lines.join("\n"));
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

            // When the user closes a multi-selection (cmd+.,w on N tabs),
            // SessionStore records each closure individually with its own
            // closedAt timestamp. Multi-close happens in <50ms, so entries
            // from the same batch cluster tightly. Walk the closed list
            // from index 0 and restore every entry within BATCH_WINDOW_MS
            // of the newest — that lifts the whole group back in one
            // undo. Tabs closed earlier (a separate session of closing)
            // sit outside the window and stay closed.
            const BATCH_WINDOW_MS = 500;
            const closedData = SS.getClosedTabData(w);
            if (!closedData || closedData.length === 0) return false;
            const newestClosedAt = closedData[0].closedAt || 0;
            let count = 1;
            for (let i = 1; i < closedData.length; i++) {
              const at = closedData[i].closedAt || 0;
              if (newestClosedAt - at <= BATCH_WINDOW_MS) count++;
              else break;
            }
            // Each undoCloseTab(0) restores the head and shifts the list,
            // so we always pop index 0 `count` times.
            for (let i = 0; i < count; i++) {
              SS.undoCloseTab(w, 0);
            }
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
          const tabs = getActionTargetTabs();
          if (tabs.length === 0) return false;
          for (const tab of tabs) {
            try { w.gBrowser.reloadTab(tab); } catch (e) {}
          }
          return true;
        },

        async reloadTabSkipCache() {
          const w = getWin();
          if (!w?.gBrowser) return false;
          const tabs = getActionTargetTabs();
          if (tabs.length === 0) return false;
          const flags = Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE
                      | Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY;
          for (const tab of tabs) {
            try { w.gBrowser.reloadTab(tab, flags); } catch (e) {}
          }
          return true;
        },

        async duplicateTab() {
          const w = getWin();
          if (!w?.gBrowser) return false;
          const tabs = getActionTargetTabs();
          if (tabs.length === 0) return false;
          for (const tab of tabs) {
            try { w.gBrowser.duplicateTab(tab); } catch (e) {}
          }
          return true;
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
          const tabs = getActionTargetTabs();
          if (tabs.length === 0) return false;
          for (const tab of tabs) {
            try { tab.toggleMuteAudio(); } catch (e) {}
          }
          return true;
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
          const tabs = getActionTargetTabs();
          if (tabs.length === 0) return false;
          const urls = [];
          for (const tab of tabs) {
            const url = tab.linkedBrowser?.currentURI?.spec || "";
            if (url) urls.push(url);
          }
          if (urls.length === 0) return false;
          try {
            const clip = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
            clip.copyString(urls.join("\n"));
            return true;
          } catch (e) {
            return false;
          }
        },

        // Activate the most-recently-accessed unread tab (newest unvisited).
        async activateUnvisitedNewest(excludeDomIds) {
          return activateUnvisitedByOrder("newest", excludeDomIds);
        },

        async activateUnvisitedOldest(excludeDomIds) {
          return activateUnvisitedByOrder("oldest", excludeDomIds);
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
          const group = w.gBrowser.getTabGroupById?.(folderId);
          if (!group || !w.gBrowser.moveTabToExistingGroup) return false;
          const tabs = getActionTargetTabs();
          if (tabs.length === 0) return false;
          for (const tab of tabs) {
            try { w.gBrowser.moveTabToExistingGroup(tab, group); } catch (e) {}
          }
          return true;
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

        // Reopen each selected tab in the given contextual identity
        // (container). For each old tab: open a new tab in the container
        // at the same URL, then remove the old. The previously-active
        // tab's replacement becomes the new active tab.
        async reopenInContainer(userContextId) {
          const w = getWin();
          if (!w?.gBrowser) return false;
          const tabs = getActionTargetTabs();
          if (tabs.length === 0) return false;
          const wasActive = w.gBrowser.selectedTab;
          let activeReplacement = null;
          for (const oldTab of tabs) {
            try {
              const url = oldTab.linkedBrowser?.currentURI?.spec || "about:newtab";
              const newTab = w.gBrowser.addTab(url, {
                userContextId,
                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
              });
              if (oldTab === wasActive) activeReplacement = newTab;
              w.gBrowser.removeTab(oldTab);
            } catch (e) {}
          }
          if (activeReplacement) {
            try { w.gBrowser.selectedTab = activeReplacement; } catch (e) {}
          }
          return true;
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

        async ensureIndexStarted() {
          tabIndex.start();
          return true;
        },

        async getIndexVersion() {
          return tabIndex.getVersion();
        },

        async getViewSummary(view, paramsJson) {
          let params = {};
          if (typeof paramsJson === "string" && paramsJson) {
            try { params = JSON.parse(paramsJson); } catch (e) { params = {}; }
          } else if (paramsJson && typeof paramsJson === "object") {
            params = paramsJson;
          }
          return tabIndex.getSummary(view, params);
        },

        async getViewWindow(view, offset, limit, paramsJson) {
          let params = {};
          if (typeof paramsJson === "string" && paramsJson) {
            try { params = JSON.parse(paramsJson); } catch (e) { params = {}; }
          } else if (paramsJson && typeof paramsJson === "object") {
            params = paramsJson;
          }
          return tabIndex.getWindow(view, offset, limit, params);
        },

        async getRowTarget(domId) {
          return tabIndex.getRowTarget(domId);
        },

        async getActiveRow() {
          return tabIndex.getActiveRow();
        },

        async getRowsByDomIds(domIdsJson) {
          let domIds = [];
          if (typeof domIdsJson === "string" && domIdsJson) {
            try { domIds = JSON.parse(domIdsJson); } catch (e) { domIds = []; }
          } else if (Array.isArray(domIdsJson)) {
            domIds = domIdsJson;
          }
          return tabIndex.getRowsByDomIds(domIds);
        },

        async getAutoCloseCandidates(cutoffMs) {
          return tabIndex.getAutoCloseCandidates(cutoffMs);
        },

        async getWorkspaceTabCounts() {
          return tabIndex.getWorkspaceTabCounts();
        },

        async getDuplicateGroups(paramsJson) {
          let params = {};
          if (typeof paramsJson === "string" && paramsJson) {
            try { params = JSON.parse(paramsJson); } catch (e) { params = {}; }
          } else if (paramsJson && typeof paramsJson === "object") {
            params = paramsJson;
          }
          return tabIndex.getDuplicateGroups(params);
        },

        async getActionsSnapshot() {
          return tabIndex.getActionsSnapshot();
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

        // DOM ids of tabs the next action should target. If the user has
        // multi-selected in the sidebar, that's the full selection set —
        // otherwise just the active tab. Used by the popup so the
        // actions menu can show a "N selected" hint and so click/chord
        // dispatch can target the right cohort.
        async getActionTargetDomIds() {
          const tabs = getActionTargetTabs();
          return tabs.map((t) => t.id);
        },

        // Extension tab IDs (the numeric kind browser.tabs.* takes) for
        // the action-target set. Used by background.js's moveTabToStart/
        // End and unloadActiveTab where the WebExtension tabs API is the
        // path of least resistance.
        async getActionTargetExtIds() {
          const tabs = getActionTargetTabs();
          const ids = [];
          for (const t of tabs) {
            const id = getExtTabId(t);
            if (id != null) ids.push(id);
          }
          return ids;
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
              .filter((t) => !visibleDomIds.has(t.id) && !isNewTabElement(t))
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

        // Drain the chord-bridge buffer (keys captured during the gap
        // between an engine firing open-view and the popup's keyboard
        // handler attaching) and mark the popup as ready. Subsequent
        // chord keys arriving from the content engine are no longer
        // buffered — they're forwarded live to the popup browser via
        // ZenChord:DeliverKey messages. The bridge itself stays alive
        // for the rest of the chord chain.
        //
        // Returns { buffered, stateSnapshot } — the popup replays the
        // buffered keys via dispatchKey before processing live input.
        // stateSnapshot is the chord-tree path the engine was at when
        // bridging began (reserved for the popup; not currently consumed).
        async takeChordBridgeBuffer(inst) {
          // Stale POPUP_READY from a popup we've since destroyed (prerender
          // swap during a chord chain). Ignore it — otherwise we drain the
          // bridge buffer that the live popup is waiting for.
          if (typeof inst === "number" && inst !== popupInstance) {
            return { buffered: [], stateSnapshot: [], stale: true };
          }
          // Warm popup may send POPUP_READY when no bridge is active (initial
          // pre-create, or rearm-without-chord-key-yet). Treat that as
          // "popup is ready; buffer empty" — popupReady still flips true so
          // any subsequent bridge keys go live via DeliverKey rather than
          // queueing to a null buffer.
          const wasBridging = bridgingEngineKind != null;
          const drained = bridgeBuffer || [];
          const snapshot = pendingStateSnapshot || [];
          // Reset the bridge buffer to an empty array so future bridge
          // keys from the engine (before forwardKeyToPopup checks
          // popupReady) don't NPE — though after popupReady is true
          // they get forwarded live, not buffered.
          bridgeBuffer = [];
          popupReady = true;
          // The chord chain may continue (popup invisible at this view,
          // user may drill via more digits). The reveal timer governs
          // when the popup becomes visible. Don't finishBridge() here.
          //
          // If the user actually buffered chord-chain keys, they're
          // committed to a fast chain — cancel chrome's reveal timer so
          // the menu doesn't flash if the popup's drain runs longer than
          // CHORD_REVEAL_TIMEOUT_MS (slow popup load + drill animation).
          // Pause-driven reveal is then the popup's responsibility (it
          // arms its own reveal timer in keyboard.js, since it owns
          // post-drain state).
          if (drained.length > 0) clearRevealTimer();
          // If the chrome reveal timer fired during popup load (which
          // would have painted a blank panel — visible flash), it set
          // revealDeferred=true and waited for us. We've now drained;
          // if there are no buffered chord keys (i.e. this is the
          // pause case the user wanted UI for, not a fast chain),
          // reveal now. For the buffered-keys case the user is in a
          // chord chain and the popup will decide reveal timing.
          if (revealDeferred) {
            revealDeferred = false;
            if (drained.length === 0 && pendingReveal) {
              // Defer one tick so the popup's init() has time to
              // render before we make it visible.
              const w = getWin();
              if (w) w.setTimeout(() => { if (pendingReveal) revealOverlay(); }, 0);
            }
          }
          // Race-safety: if the user chorded during initial popup load,
          // a WarmRearm message may have been dropped because the frame
          // script wasn't registered yet. The popup's IIFE will see this
          // `view` in the reply and navigate before replaying buffered
          // keys, so chord-chain digits land at the right view.
          const replyView = (currentViewName && currentViewName !== "actions") ? currentViewName : null;
          return {
            buffered: drained,
            stateSnapshot: snapshot,
            view: replyView,
            armRevealTimer: wasBridging || drained.length > 0,
          };
        },

        // Palette management.
        //
        // Returns a discriminated object describing what happened:
        //   {kind: "opened"}            — overlay opened (with main menu or a view)
        //   {kind: "closed"}            — overlay was already open and got closed (toggle)
        //
        // Callers:
        //   - browserAction.onClicked passes {skipChord:true} → opens immediately
        //   - any caller can pass a view string to open directly to a submenu
        //
        // Chord leaders (cmd+., option+., etc.) do not route through here
        // — they go through background.js's commands.onCommand → armChord.
        // This is for toolbar-icon clicks and explicit external opens.
        async showPalette(viewOrOpts) {
          let view = null;
          if (typeof viewOrOpts === "string") {
            view = viewOrOpts;
          } else if (viewOrOpts && typeof viewOrOpts === "object") {
            view = viewOrOpts.view || null;
          }

          if (isOverlayVisible()) {
            destroyOverlay();
            return { kind: "closed" };
          }

          {
            const w = getWin();
            const overlay = w && w.document.getElementById(OVERLAY_ID);
            const br = w && w.document.getElementById(BROWSER_ID);
            if (overlay && overlay.style.visibility === "hidden" && !browserHasCurrentGeneration(br)) {
              destroyOverlay({ hard: true, silent: true });
            }
          }

          // A chord might be in flight (engine armed/bridging) when this
          // is invoked by an external path (toolbar icon click). Tear
          // down any in-flight chord state
          // in both engines so we open cleanly.
          if (chromeEngine && chromeEngine.isArmed()) chromeEngine.reset();
          try { Services.mm.broadcastAsyncMessage("ZenChord:Reset"); } catch (e) {}

          if (view) {
            revealDeferred = true;
            createFreshOverlayForDirectOpen(view, null);
            scheduleExplicitViewReveal(view);
            return { kind: "opened" };
          }

          // Direct main-menu opens use the same warm-rearm path as
          // submenus. Use a fresh overlay for this external path so an
          // in-flight soft-hide reset from the previous submenu cannot
          // race the new requested view.
          revealDeferred = true;
          createFreshOverlayForDirectOpen(null, null);
          scheduleExplicitViewReveal("actions");
          return { kind: "opened" };
        },

        async hidePalette() {
          destroyOverlay();
        },

        // Duplicate-prompt outcomes. Each pops a saved pendingDuplicate
        // captured at openLinkIn intercept time.

        async duplicateSwitch() {
          if (!pendingDuplicate) { destroyOverlay(); return false; }
          const w = getWin();
          let target = null;
          if (w?.gBrowser) {
            for (const tab of w.gBrowser.tabs) {
              const u = tab.linkedBrowser?.currentURI?.spec || "";
              if (u === pendingDuplicate.url) { target = tab; break; }
            }
          }
          pendingDuplicate = null;
          destroyOverlay();
          if (target) return activateNativeTab(target);
          return false;
        },

        async duplicateOpenAnyway() {
          if (!pendingDuplicate || !origOpenLinkIn) { destroyOverlay(); return false; }
          const { url, where, params } = pendingDuplicate;
          pendingDuplicate = null;
          destroyOverlay();
          try { origOpenLinkIn.call(null, url, where, params); return true; }
          catch (e) { return false; }
        },

        // Pop the duplicate-prompt overlay for a URL detected by some
        // path other than openLinkIn (e.g. bg's webRequest blocker for
        // plain same-tab link clicks). Caller owns the "switch / open
        // anyway / cancel" handling on their side — chrome only renders
        // the prompt. Returns the existing-tab dom id so the caller can
        // wire up the Switch action without re-doing the URL lookup.
        async showDuplicatePrompt(url) {
          const existing = urlMatchesAnyOpenTab(url, null);
          if (!existing) return null;
          try {
            createOverlay("duplicate-prompt", { url, domId: existing.id });
            revealDeferred = true;
          } catch (e) {}
          return existing.id;
        },

        // Replay the last engine-fired chord. Returns true if something
        // was replayed; false if no chord has been recorded yet (cold
        // session). Bg's REPLAY_LAST_CHORD handler calls this; only falls
        // back to its own popup-action recording if this returns false.
        async replayLastChord() {
          return replayLastChordTrace();
        },

        // Popup-side trace hook for slow-typed chord chains. When the
        // popup processes a digit/letter that activates an item, it
        // sends this so chrome records the key the same way it would
        // have recorded an engine-bridged key (cmd+.,r,2 fast). Without
        // this, slow typing (menu showed, then digit) wouldn't track
        // and cmd+.,. would have nothing to replay.
        async traceReplayKey(key) {
          if (typeof key === "string" && key.length > 0) {
            trackChordBridgeKey({ key });
          }
        },

        // Commit-on-action hook. Bg calls this for every popup-fired
        // runtime action so chrome decides whether to promote the
        // in-flight chord chain to lastChordReplay (cycling-capable
        // replay) or commit a raw action. The blocklist inside
        // recordReplayFromPopupAction keeps the replay action itself
        // and the duplicate-prompt outcomes out of the trace.
        async recordReplayContext(message) {
          recordReplayFromPopupAction(message);
        },


        // Force-arm the chord engines from an external trigger — used by
        // background.js's commands.onCommand handler so the configurable
        // open-palette shortcut (default cmd+.) acts as a chord leader
        // rather than just opening the palette. We arm the chrome engine
        // synchronously and send a targeted message to the currently-
        // focused tab's content process so its engine arms too — without
        // this the user's next chord key would reach an idle content
        // engine and leak through to the page.
        async armChord() {
          armChordFromLeader();
        },

        // Popup-driven reveal. Called when the popup's own reveal-on-pause
        // timer fires (it's the authority on user activity post-drain,
        // since chord-chain keys are processed inside the popup). No-op
        // if the popup has already become visible. The `inst` parameter
        // gates against a stale popup (one that was created during a
        // prerender swap and has since been destroyed) firing this and
        // unexpectedly revealing its replacement.
        async revealPalette(inst) {
          if (typeof inst === "number" && inst !== popupInstance) return;
          if (revealBlocked) return;
          if (pendingReveal) revealOverlay();
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
          const prevView = currentViewName;
          currentViewName = view;
          // Record the nav as the in-flight chord's open-view target so
          // cmd+.,. replay rebuilds the same sequence. This is only for
          // chord-opened popups (root timeout / bridge); toolbar-clicked
          // visible navigation is not itself replayable and must not
          // poison the previous leaf action.
          if (bridgingEngineKind != null || currentChordReplay) {
            trackChordOpenView(view);
          }
          // Only swap browsers when crossing between our popup and a
          // foreign extension's popup. For our-view → our-view, we
          // just update the nav stack here — the popup runs its
          // cross-fade at the current panel size and calls resizePanel
          // when it's done. That avoids reflow during the fade.
          if (view === "extension-popup" || prevView === "extension-popup") {
            morphToView(view, parsed);
          }
        },

        async resizePanel(view, height) {
          if (!isOverlayOpen()) return;
          resizePanelToView(view, height);
          if (revealDeferred && pendingReveal && (!bridgeBuffer || bridgeBuffer.length === 0)) {
            revealDeferred = false;
            const w = getWin();
            if (w) w.setTimeout(() => { if (pendingReveal) revealOverlay(); }, 0);
          }
        },

        async navigateBack() {
          if (!isOverlayOpen()) return null;
          if (navStack.length === 0) {
            destroyOverlay();
            return null;
          }
          const prev = navStack.pop();
          const wasInForeign = currentViewName === "extension-popup";
          currentViewName = prev.view;
          if (wasInForeign) {
            morphToView(prev.view, prev.params);
            return null;
          }
          // For our-view → our-view back nav, don't resize here. The
          // popup will cross-fade and then call resizePanel.
          return { view: prev.view, params: prev.params || {} };
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

        // Swap the palette into a foreign extension's popup. Opens
        // the overlay first if it isn't already open so the chord
        // shortcut path can use the same entry point.
        async openExtensionPopup(extensionId) {
          await openExtensionPopupInternal(extensionId);
        },

        // Toggle the Services.ww.openWindow monkey-patch. Background.js
        // pushes this from the interceptExtensionPopups setting.
        async setExtensionPopupIntercept(enabled) {
          interceptEnabled = !!enabled;
        },

        // Toggle overlay reveal/dismiss animations. Background pushes
        // this from the skipOverlayAnimations setting. Sub-menu cross-
        // fades inside an open palette are unaffected.
        async setSkipOverlayAnimations(skip) {
          skipOverlayAnimations = !!skip;
        },

        // Toggle the backdrop dim behind the palette. Background pushes
        // this from the dimBackdrop setting. Updates the warm overlay's
        // background immediately so the change is visible without
        // waiting for the next chord arm.
        async setDimBackdrop(enabled) {
          dimBackdrop = !!enabled;
          const w = getWin();
          const overlay = w && w.document.getElementById(OVERLAY_ID);
          if (overlay) overlay.style.background = overlayBackdropColor();
        },

        // Toggle the duplicate-tab intercept (openLinkIn hook). Bg pushes
        // this from the duplicateTabIntercept setting. The orange URL
        // pill on hover is always on; this only gates the interactive
        // prompt that catches the click/navigation.
        async setDuplicateTabIntercept(enabled) {
          duplicateTabInterceptEnabled = !!enabled;
        },

        // User-facing single delay for chord timeouts. Background
        // pushes this from the chordDelayMs setting. applyChordDelay
        // updates the chrome engine's constants and broadcasts to
        // content frame scripts. The popup picks it up from its URL
        // ?delay=N param at load time.
        async setChordDelay(ms) {
          applyChordDelay(ms);
        },

      },
    };
  }
};
