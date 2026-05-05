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
    case "go-to-parent-tab":
      browser.zenWorkspaces.goToParentTab();
      break;
    case "go-to-previous-tab":
      browser.zenWorkspaces.goToPreviousTab();
      break;
    case "move-tab-to-start":
      moveTabToStart();
      break;
    case "move-tab-to-end":
      moveTabToEnd();
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

    case "sort-tabs-by-recent": {
      (async () => {
        await browser.zenWorkspaces.hidePalette();
        const allTabs = await browser.tabs.query({ currentWindow: true });
        const pinnedCount = allTabs.filter((t) => t.pinned).length;
        const tabs = allTabs.filter((t) => !t.pinned);
        // Most recently accessed first → top of tab bar
        tabs.sort((a, b) => b.lastAccessed - a.lastAccessed);
        // Batch move preserves the array order
        await browser.tabs.move(
          tabs.map((t) => t.id),
          { index: pinnedCount }
        );
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
          try {
            const domainA = new URL(a.url).hostname;
            const domainB = new URL(b.url).hostname;
            return domainA.localeCompare(domainB);
          } catch (e) {
            return 0;
          }
        });
        for (let i = 0; i < tabs.length; i++) {
          await browser.tabs.move(tabs[i].id, { index: pinnedCount + i });
        }
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