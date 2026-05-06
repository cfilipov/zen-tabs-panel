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
  if (!activeTab || activeTab.pinned) return;

  // Find the first unpinned tab index to avoid moving into the pinned range
  const allTabs = await browser.tabs.query({ currentWindow: true });
  const firstUnpinned = allTabs.find((t) => !t.pinned);
  const targetIndex = firstUnpinned ? firstUnpinned.index : 0;

  await browser.tabs.move(activeTab.id, { index: targetIndex });
}

async function moveTabToEnd() {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || activeTab.pinned) return;
  await browser.tabs.move(activeTab.id, { index: -1 });
}

browser.commands.onCommand.addListener((command) => {
  switch (command) {
    case "open-palette":
      browser.zenWorkspaces.showPalette();
      break;

    case "go-to-previous-tab":
      browser.zenWorkspaces.goToPreviousTab();
      break;
    case "go-to-parent-tab":
      browser.zenWorkspaces.goToParentTab();
      break;
    case "move-tab-to-start":
      moveTabToStart();
      break;
    case "move-tab-to-end":
      moveTabToEnd();
      break;
    case "scroll-to-current-tab":
      browser.zenWorkspaces.scrollCurrentTabIntoView();
      break;
    case "unload-tab": {
      (async () => {
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) return;
        const parentResult = await browser.zenWorkspaces.goToParentTab();
        if (!parentResult) await browser.zenWorkspaces.goToPreviousTab();
        try { await browser.tabs.discard(activeTab.id); } catch (e) {}
      })();
      break;
    }

    case "child-tabs":
    case "sibling-tabs":
    case "unvisited-tabs":
    case "last-visited":
    case "duplicates":
    case "tab-info":
    case "domains":
    case "tabs-by-age":
    case "most-visited":
    case "reorder-tabs":
    case "move-to-workspace":
      browser.zenWorkspaces.showPalette(command);
      break;
  }
});

// Toolbar icon click opens the palette
browser.browserAction.onClicked.addListener(() => {
  browser.zenWorkspaces.showPalette();
});

// ---------------------------------------------------------------------------
// Message handler — popup can request data/actions from background
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "hide-palette":
      browser.zenWorkspaces.hidePalette();
      break;

    case "open-options":
      browser.zenWorkspaces.hidePalette();
      browser.runtime.openOptionsPage();
      break;

    case "activate-tab":
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        await browser.zenWorkspaces.activateTabByDomId(message.domId);
      })();
      break;

    case "get-all-tabs":
      return browser.zenWorkspaces.getAllTabs();

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
        await browser.zenWorkspaces.scrollCurrentTabIntoView();
      })();
      break;

    case "unload-tab": {
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) return;

        const parentResult = await browser.zenWorkspaces.goToParentTab();
        if (!parentResult) {
          await browser.zenWorkspaces.goToPreviousTab();
        }

        try {
          await browser.tabs.discard(activeTab.id);
        } catch (e) {}
      })();
      break;
    }

    case "sort-tabs-recent-desc":
    case "sort-tabs-recent-asc":
    case "sort-tabs-domain-alpha":
    case "sort-tabs-domain-pop":
    case "sort-tabs-age-asc":
    case "sort-tabs-age-desc":
    case "sort-tabs-inactive-bottom":
    case "sort-tabs-most-visited":
    case "sort-tabs-group-dups": {
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        const allTabs = await browser.tabs.query({ currentWindow: true });
        const pinnedCount = allTabs.filter((t) => t.pinned).length;
        const tabs = allTabs.filter((t) => !t.pinned);

        const getDomain = (url) => { try { return new URL(url).hostname; } catch (e) { return ""; } };

        switch (message.type) {
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
            const seen = new Set();
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

        await browser.tabs.move(tabs.map((t) => t.id), { index: pinnedCount });
      })();
      break;
    }

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