"use strict";

// ---------------------------------------------------------------------------
// Auto-move to top — delayed move of the active tab to index 0
//
// NOTE: We track the "last user-activated" tab ID so that workspace switches
// (which also fire onActivated) don't trigger auto-move for the tab that
// Zen automatically selects when switching workspaces.
// ---------------------------------------------------------------------------

let autoMoveTimeout = null;
let lastActiveTabId = null;

function cancelAutoMove() {
  if (autoMoveTimeout !== null) {
    clearTimeout(autoMoveTimeout);
    autoMoveTimeout = null;
  }
}

async function scheduleAutoMove(tabId, delay) {
  cancelAutoMove();

  const doMove = async () => {
    try {
      const tab = await browser.tabs.get(tabId);
      // Only move unpinned tabs, and only if still the active tab
      if (!tab.pinned && tab.active) {
        // Find the first unpinned index to avoid moving into pinned range
        const allTabs = await browser.tabs.query({ currentWindow: true });
        const firstUnpinned = allTabs.find((t) => !t.pinned);
        const targetIndex = firstUnpinned ? firstUnpinned.index : 0;
        await browser.tabs.move(tabId, { index: targetIndex });
      }
    } catch (e) {
      // Tab may have been closed
    }
    autoMoveTimeout = null;
  };

  if (delay <= 0) {
    doMove();
  } else {
    autoMoveTimeout = setTimeout(doMove, delay);
  }
}

// ---------------------------------------------------------------------------
// Auto-close sweep — periodic cleanup of stale unpinned tabs
//
// NOTE: browser.tabs.query only returns current workspace tabs in Zen.
// For a full sweep across workspaces, use browser.zenWorkspaces.getAllTabs().
// ---------------------------------------------------------------------------

const THRESHOLD_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "48h": 48 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000,
};

async function autoCloseSweep() {
  const settings = await browser.storage.local.get({
    autoCloseEnabled: false,
    autoCloseThreshold: "48h",
  });

  if (!settings.autoCloseEnabled) return;

  const threshold = THRESHOLD_MS[settings.autoCloseThreshold] || THRESHOLD_MS["48h"];
  const now = Date.now();

  // Use the experiment API to get tabs across all workspaces
  let tabs;
  try {
    tabs = await browser.zenWorkspaces.getAllTabs();
  } catch (e) {
    // Fallback to standard API (current workspace only)
    tabs = await browser.tabs.query({ pinned: false });
  }

  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (tab.active) continue;
    if (now - tab.lastAccessed > threshold) {
      try {
        await browser.zenWorkspaces.closeTabByDomId(tab.domId);
      } catch (e) {
        // Tab may already be gone
      }
    }
  }
}

// Set up alarm for auto-close sweep (every 5 minutes)
browser.alarms.create("auto-close-sweep", { periodInMinutes: 5 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "auto-close-sweep") {
    autoCloseSweep();
  }
});

// ---------------------------------------------------------------------------
// Tab event listeners
// ---------------------------------------------------------------------------

browser.tabs.onActivated.addListener(async (activeInfo) => {
  lastActiveTabId = activeInfo.tabId;

  // Auto-move logic
  const settings = await browser.storage.local.get({
    autoMoveEnabled: false,
    autoMoveDelay: 3000,
  });

  if (settings.autoMoveEnabled) {
    scheduleAutoMove(activeInfo.tabId, settings.autoMoveDelay);
  } else {
    cancelAutoMove();
  }
});

// ---------------------------------------------------------------------------
// Duplicate indicator sync
// ---------------------------------------------------------------------------

browser.tabs.onCreated.addListener(() => {
  browser.zenWorkspaces.syncDuplicates();
});

browser.tabs.onRemoved.addListener(() => {
  browser.zenWorkspaces.syncDuplicates();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    browser.zenWorkspaces.syncDuplicates();
  }
});

// ---------------------------------------------------------------------------
// Command handlers
//
// goToPreviousTab and goToParentTab are handled by the experiment API
// (browser.zenWorkspaces) which operates in chrome context and supports
// cross-workspace switching.
// ---------------------------------------------------------------------------

async function moveTabToStart() {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  const allTabs = await browser.tabs.query({ currentWindow: true });
  const essentialIds = new Set(await browser.zenWorkspaces.getEssentialTabIds());

  if (activeTab.pinned) {
    if (essentialIds.has(activeTab.id)) return;
    const firstNonEssentialPinned = allTabs.find((t) => t.pinned && !essentialIds.has(t.id));
    const targetIndex = firstNonEssentialPinned ? firstNonEssentialPinned.index : 0;
    await browser.tabs.move(activeTab.id, { index: targetIndex });
  } else {
    const firstUnpinned = allTabs.find((t) => !t.pinned);
    const targetIndex = firstUnpinned ? firstUnpinned.index : 0;
    await browser.tabs.move(activeTab.id, { index: targetIndex });
  }
}

async function moveTabToEnd() {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  if (activeTab.pinned) {
    const essentialIds = new Set(await browser.zenWorkspaces.getEssentialTabIds());
    if (essentialIds.has(activeTab.id)) return;
    const allTabs = await browser.tabs.query({ currentWindow: true });
    const pinnedTabs = allTabs.filter((t) => t.pinned);
    const lastPinnedIndex = pinnedTabs.length > 0 ? pinnedTabs[pinnedTabs.length - 1].index : 0;
    await browser.tabs.move(activeTab.id, { index: lastPinnedIndex });
  } else {
    await browser.tabs.move(activeTab.id, { index: -1 });
  }
}

async function scrollToCurrentTab() {
  await browser.zenWorkspaces.scrollCurrentTabIntoView();
}

async function unloadActiveTab() {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  const parentResult = await browser.zenWorkspaces.goToParentTab();
  if (!parentResult) {
    await browser.zenWorkspaces.goToPreviousTab();
  }

  try {
    await browser.tabs.discard(activeTab.id);
  } catch (e) {}
}

const CLOSE_AND_SELECT_NAVS = {
  // No-op navigation: just close the active tab and let the browser pick
  // the successor (matches default Cmd+W behavior).
  "close-and-select-default":       () => Promise.resolve(true),
  "close-and-select-previous":      () => browser.zenWorkspaces.goToPreviousTab(),
  "close-and-select-parent":        () => browser.zenWorkspaces.goToParentTab(),
  "close-and-select-next-sibling":  () => browser.zenWorkspaces.goToNextSibling(),
  "close-and-select-prev-sibling":  () => browser.zenWorkspaces.goToPrevSibling(),
  "close-and-select-next-vertical": () => browser.zenWorkspaces.goToNextVerticalTab(),
  "close-and-select-prev-vertical": () => browser.zenWorkspaces.goToPrevVerticalTab(),
};

async function closeAndSelect(actionId) {
  const navFn = CLOSE_AND_SELECT_NAVS[actionId];
  if (!navFn) return;
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || activeTab.pinned) return;
  const ok = await navFn();
  if (!ok) return;
  await browser.tabs.remove(activeTab.id);
}

async function openOptions() {
  browser.runtime.openOptionsPage();
}

const SORT_ACTIONS = new Set([
  "sort-tabs-recent-desc",
  "sort-tabs-recent-asc",
  "sort-tabs-domain-alpha",
  "sort-tabs-domain-pop",
  "sort-tabs-age-asc",
  "sort-tabs-age-desc",
  "sort-tabs-inactive-bottom",
  "sort-tabs-most-visited",
  "sort-tabs-group-dups",
]);

async function runSortAction(actionId) {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  const allTabs = await browser.tabs.query({ currentWindow: true });
  const essentialIds = new Set(await browser.zenWorkspaces.getEssentialTabIds());
  const operateOnPinned = activeTab?.pinned && !essentialIds.has(activeTab?.id);

  let tabs, startIndex;
  if (operateOnPinned) {
    const essentialCount = allTabs.filter((t) => essentialIds.has(t.id)).length;
    tabs = allTabs.filter((t) => t.pinned && !essentialIds.has(t.id));
    startIndex = essentialCount;
  } else {
    const pinnedCount = allTabs.filter((t) => t.pinned).length;
    tabs = allTabs.filter((t) => !t.pinned);
    startIndex = pinnedCount;
  }

  const getDomain = (url) => { try { return new URL(url).hostname; } catch (e) { return ""; } };

  switch (actionId) {
    case "sort-tabs-recent-desc":
      tabs.sort((a, b) => b.lastAccessed - a.lastAccessed);
      break;
    case "sort-tabs-recent-asc":
      tabs.sort((a, b) => a.lastAccessed - b.lastAccessed);
      break;
    case "sort-tabs-domain-alpha":
      tabs.sort((a, b) => getDomain(a.url).localeCompare(getDomain(b.url)) || b.lastAccessed - a.lastAccessed);
      break;
    case "sort-tabs-domain-pop": {
      const domainCounts = {};
      for (const t of tabs) {
        const d = getDomain(t.url);
        domainCounts[d] = (domainCounts[d] || 0) + 1;
      }
      tabs.sort((a, b) => (domainCounts[getDomain(b.url)] || 0) - (domainCounts[getDomain(a.url)] || 0) || b.lastAccessed - a.lastAccessed);
      break;
    }
    case "sort-tabs-age-asc":
      tabs.sort((a, b) => a.id - b.id);
      break;
    case "sort-tabs-age-desc":
      tabs.sort((a, b) => b.id - a.id);
      break;
    case "sort-tabs-inactive-bottom":
      tabs.sort((a, b) => (a.discarded ? 1 : 0) - (b.discarded ? 1 : 0));
      break;
    case "sort-tabs-most-visited": {
      const uniqueUrls = [...new Set(tabs.map((t) => t.url))];
      const visitCounts = {};
      await Promise.all(uniqueUrls.map((url) =>
        browser.history.getVisits({ url }).then(
          (visits) => { visitCounts[url] = visits.length; },
          () => { visitCounts[url] = 0; }
        )
      ));
      tabs.sort((a, b) => (visitCounts[b.url] || 0) - (visitCounts[a.url] || 0));
      break;
    }
    case "sort-tabs-group-dups": {
      const urlCount = {};
      for (const t of tabs) urlCount[t.url] = (urlCount[t.url] || 0) + 1;
      const dups = [];
      const nonDups = [];
      for (const t of tabs) {
        if (urlCount[t.url] > 1) {
          dups.push(t);
        } else {
          nonDups.push(t);
        }
      }
      dups.sort((a, b) => a.url.localeCompare(b.url));
      tabs.length = 0;
      tabs.push(...dups, ...nonDups);
      break;
    }
  }

  await browser.tabs.move(tabs.map((t) => t.id), { index: startIndex });
}

// Run an action that was triggered via a chord shortcut. The palette never
// opened in this path, so we skip the hidePalette() call that the message
// handlers below use.
async function runChordAction(actionId) {
  switch (actionId) {
    case "go-to-previous-tab":
      await browser.zenWorkspaces.goToPreviousTab();
      return;
    case "go-to-parent-tab":
      await browser.zenWorkspaces.goToParentTab();
      return;
    case "move-tab-to-start":
      await moveTabToStart();
      return;
    case "move-tab-to-end":
      await moveTabToEnd();
      return;
    case "scroll-to-current-tab":
      await scrollToCurrentTab();
      return;
    case "unload-tab":
      await unloadActiveTab();
      return;
    case "open-options":
      await openOptions();
      return;
    case "go-to-next-workspace":
      await browser.zenWorkspaces.goToNextWorkspace();
      return;
    case "go-to-prev-workspace":
      await browser.zenWorkspaces.goToPrevWorkspace();
      return;
    case "toggle-pin-tab":
      await browser.zenWorkspaces.togglePinTab();
      return;
    case "copy-url-markdown":
      await browser.zenWorkspaces.copyCurrentUrlMarkdown();
      return;
    case "restore-last-closed-tab":
      await browser.zenWorkspaces.restoreLastClosedTab();
      return;
    case "split-new":
      await browser.zenWorkspaces.splitNew();
      return;
    case "split-close":
      await browser.zenWorkspaces.splitClose();
      return;
    case "split-horizontal":
      await browser.zenWorkspaces.splitHorizontal();
      return;
    case "split-vertical":
      await browser.zenWorkspaces.splitVertical();
      return;
  }
  if (SORT_ACTIONS.has(actionId)) {
    await runSortAction(actionId);
    return;
  }
  if (CLOSE_AND_SELECT_NAVS[actionId]) {
    await closeAndSelect(actionId);
  }
}

async function handleOpenPaletteRequest() {
  const result = await browser.zenWorkspaces.showPalette();
  if (result && result.kind === "chord-action") {
    await runChordAction(result.actionId);
  }
}

browser.commands.onCommand.addListener(async (command) => {
  if (command !== "open-palette") return;
  await handleOpenPaletteRequest();
});

// Chrome-side gesture (double-tap Cmd) — see experiment/api.js.
browser.zenWorkspaces.onPaletteRequest.addListener(handleOpenPaletteRequest);

// Toolbar icon click opens the palette immediately, bypassing chord-arming.
browser.browserAction.onClicked.addListener(() => {
  browser.zenWorkspaces.showPalette({ skipChord: true });
});

// ---------------------------------------------------------------------------
// Message handler — popup can request data/actions from background
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "hide-palette":
      browser.zenWorkspaces.hidePalette();
      break;

    case "navigate-view":
      browser.zenWorkspaces.navigateToView(message.view, message.params);
      break;

    case "navigate-back":
      browser.zenWorkspaces.navigateBack();
      break;

    case "open-options":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await openOptions();
      })();
      break;

    case "activate-tab":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await browser.zenWorkspaces.activateTabByDomId(message.domId);
      })();
      break;

    case "get-all-tabs":
      return browser.zenWorkspaces.getAllTabs();

    case "get-default-close-target":
      return browser.zenWorkspaces.getDefaultCloseTargetDomId();

    case "get-active-tab-info": {
      // Check if the current tab has a parent (opener) tab
      const promise = (async () => {
        const allTabs = await browser.zenWorkspaces.getAllTabs();
        const activeTab = allTabs.find((t) => t.active);
        return {
          hasParent: !!(activeTab && activeTab.openerTabDomId),
        };
      })();
      return promise;
    }

    case "go-to-previous-tab":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await browser.zenWorkspaces.goToPreviousTab();
      })();
      break;

    case "go-to-parent-tab":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await browser.zenWorkspaces.goToParentTab();
      })();
      break;

    case "move-tab-to-start":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await moveTabToStart();
      })();
      break;

    case "move-tab-to-end":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await moveTabToEnd();
      })();
      break;

    case "scroll-to-current-tab":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await scrollToCurrentTab();
      })();
      break;

    case "unload-tab":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await unloadActiveTab();
      })();
      break;

    case "close-and-select-default":
    case "close-and-select-previous":
    case "close-and-select-parent":
    case "close-and-select-next-sibling":
    case "close-and-select-prev-sibling":
    case "close-and-select-next-vertical":
    case "close-and-select-prev-vertical":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await closeAndSelect(message.type);
      })();
      break;

    case "go-to-next-workspace":
    case "go-to-prev-workspace":
    case "toggle-pin-tab":
    case "copy-url-markdown":
    case "restore-last-closed-tab":
    case "split-new":
    case "split-close":
    case "split-horizontal":
    case "split-vertical": {
      const method = {
        "go-to-next-workspace":     "goToNextWorkspace",
        "go-to-prev-workspace":     "goToPrevWorkspace",
        "toggle-pin-tab":           "togglePinTab",
        "copy-url-markdown":        "copyCurrentUrlMarkdown",
        "restore-last-closed-tab":  "restoreLastClosedTab",
        "split-new":                "splitNew",
        "split-close":              "splitClose",
        "split-horizontal":         "splitHorizontal",
        "split-vertical":           "splitVertical",
      }[message.type];
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await browser.zenWorkspaces[method]();
      })();
      break;
    }

    case "get-navigation-history":
      return browser.zenWorkspaces.getNavigationHistory();

    case "get-recently-closed":
      return browser.sessions.getRecentlyClosed({ maxResults: 25 }).then((sessions) =>
        sessions
          .filter((s) => s.tab)
          .map((s) => ({
            sessionId: s.tab.sessionId,
            title: s.tab.title || "",
            url: s.tab.url || "",
            favIconUrl: s.tab.favIconUrl || "",
            lastModified: s.lastModified || 0,
          }))
      );

    case "restore-closed-tab":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        try { await browser.sessions.restore(message.sessionId); } catch (e) {}
      })();
      break;

    case "navigate-to-history-index":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await browser.zenWorkspaces.navigateToHistoryIndex(message.index);
      })();
      break;

    case "switch-workspace":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await browser.zenWorkspaces.switchTo(message.workspaceId);
      })();
      break;

    case "sort-tabs-recent-desc":
    case "sort-tabs-recent-asc":
    case "sort-tabs-domain-alpha":
    case "sort-tabs-domain-pop":
    case "sort-tabs-age-asc":
    case "sort-tabs-age-desc":
    case "sort-tabs-inactive-bottom":
    case "sort-tabs-most-visited":
    case "sort-tabs-group-dups":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await runSortAction(message.type);
      })();
      break;

    case "sort-tabs-by-recent": {
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        const allTabs = await browser.tabs.query({ currentWindow: true });
        const pinnedCount = allTabs.filter((t) => t.pinned).length;
        const tabs = allTabs.filter((t) => !t.pinned);
        tabs.sort((a, b) => b.lastAccessed - a.lastAccessed);
        await browser.tabs.move(tabs.map((t) => t.id), { index: pinnedCount });
      })();
      break;
    }

    case "sort-tabs-by-domain": {
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        const allTabs = await browser.tabs.query({ currentWindow: true });
        const pinnedCount = allTabs.filter((t) => t.pinned).length;
        const tabs = allTabs.filter((t) => !t.pinned);
        tabs.sort((a, b) => {
          try { return new URL(a.url).hostname.localeCompare(new URL(b.url).hostname); }
          catch (e) { return 0; }
        });
        await browser.tabs.move(tabs.map((t) => t.id), { index: pinnedCount });
      })();
      break;
    }

    case "preview-tab":
      browser.zenWorkspaces.previewTab(message.domId);
      break;

    case "clear-preview":
      browser.zenWorkspaces.clearPreview();
      break;

    case "close-tab":
      browser.zenWorkspaces.closeTabByDomId(message.domId);
      break;

    case "get-tab-info":
      return browser.zenWorkspaces.getTabInfo(message.domId);

    case "get-history-visits":
      return browser.history.getVisits({ url: message.url });

    case "get-selected-tab-dom-ids":
      return browser.zenWorkspaces.getSelectedTabDomIds();

    case "get-selected-tab-urls":
      return browser.zenWorkspaces.getSelectedTabUrls();

    case "get-workspaces-with-icons":
      return browser.zenWorkspaces.getWorkspacesWithIcons();

    case "move-selected-tabs-to-workspace":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await browser.zenWorkspaces.moveSelectedTabsToWorkspace(message.workspaceId);
      })();
      break;

    case "check-companion-mod":
      return browser.zenWorkspaces.getCompanionMods();

    case "install-companion-mod":
      return browser.zenWorkspaces.installCompanionMod(message.modId);

    case "remove-companion-mod":
      return browser.zenWorkspaces.removeCompanionMod(message.modId);
  }
});

// ---------------------------------------------------------------------------
// Tab context menu
// ---------------------------------------------------------------------------

browser.menus.create({
  id: "copy-selected-urls",
  title: "Copy Selected Tab URLs",
  contexts: ["tab"],
  visible: false,
});

browser.menus.onShown.addListener(async (info) => {
  if (!info.contexts.includes("tab")) return;
  const urls = await browser.zenWorkspaces.getSelectedTabUrls();
  browser.menus.update("copy-selected-urls", { visible: urls.length > 1 });
  browser.menus.refresh();
});

browser.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "copy-selected-urls") return;
  const urls = await browser.zenWorkspaces.getSelectedTabUrls();
  if (urls.length > 0) {
    navigator.clipboard.writeText(urls.join("\n"));
  }
});

// ---------------------------------------------------------------------------
// Initialize — trigger experiment API load (it's lazy, only loads on first access)
// ---------------------------------------------------------------------------

browser.zenWorkspaces.getActiveWorkspaceId().catch(() => {});
browser.zenWorkspaces.syncDuplicates().catch(() => {});

// Show welcome page on first install
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const { welcomed } = await browser.storage.local.get({ welcomed: false });
    if (!welcomed) {
      await browser.storage.local.set({ welcomed: true });
      browser.tabs.create({ url: browser.runtime.getURL("welcome/welcome.html") });
    }
  }
});