"use strict";

const api = browser.zenWorkspaces;

// ---------------------------------------------------------------------------
// In-memory settings cache
//
// Avoids hitting browser.storage.local on every tab activation (and from the
// 5-minute auto-close alarm). Populated once at startup, kept in sync via
// storage.onChanged. The cache also gates whether the auto-close alarm even
// exists — disabled means no idle work at all.
// ---------------------------------------------------------------------------

const settings = Object.assign({}, STORAGE_DEFAULTS);

async function loadSettings() {
  const stored = await browser.storage.local.get(STORAGE_DEFAULTS);
  Object.assign(settings, stored);
  syncAutoCloseAlarm();
  pushInterceptSetting();
}

function pushInterceptSetting() {
  api.setExtensionPopupIntercept(!!settings.interceptExtensionPopups).catch(() => {});
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  let autoCloseTouched = false;
  let interceptTouched = false;
  for (const key of Object.keys(changes)) {
    if (key in STORAGE_DEFAULTS) {
      settings[key] = changes[key].newValue ?? STORAGE_DEFAULTS[key];
      if (key === "autoCloseEnabled") autoCloseTouched = true;
      if (key === "interceptExtensionPopups") interceptTouched = true;
    }
  }
  if (autoCloseTouched) syncAutoCloseAlarm();
  if (interceptTouched) pushInterceptSetting();
});

// ---------------------------------------------------------------------------
// Auto-move to top — delayed move of the active tab to index 0
// ---------------------------------------------------------------------------

let autoMoveTimeout = null;

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
  if (!settings.autoCloseEnabled) return;

  const threshold = THRESHOLD_MS[settings.autoCloseThreshold] || THRESHOLD_MS["48h"];
  const now = Date.now();

  // Use the experiment API to get tabs across all workspaces
  let tabs;
  try {
    tabs = await api.getAllTabs();
  } catch (e) {
    // Fallback to standard API (current workspace only)
    tabs = await browser.tabs.query({ pinned: false });
  }

  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (tab.active) continue;
    if (now - tab.lastAccessed > threshold) {
      try {
        await api.closeTabByDomId(tab.domId);
      } catch (e) {
        // Tab may already be gone
      }
    }
  }
}

// Create the alarm only when auto-close is enabled — when disabled (the
// default) we want zero idle CPU. The alarm is added/removed in response to
// settings changes via the storage.onChanged listener above.
function syncAutoCloseAlarm() {
  if (settings.autoCloseEnabled) {
    browser.alarms.create("auto-close-sweep", { periodInMinutes: 5 });
  } else {
    browser.alarms.clear("auto-close-sweep");
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "auto-close-sweep") {
    autoCloseSweep();
  }
});

// ---------------------------------------------------------------------------
// Tab event listeners
// ---------------------------------------------------------------------------

browser.tabs.onActivated.addListener((activeInfo) => {
  if (settings.autoMoveEnabled) {
    scheduleAutoMove(activeInfo.tabId, settings.autoMoveDelay);
  } else {
    cancelAutoMove();
  }
  api.markTabVisitedByExtId(activeInfo.tabId).catch(() => {});
});

// Pause focus-duration accumulation while the browser window is unfocused, so
// time spent in another app doesn't inflate any tab's focusDurationSeconds.
browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    api.pauseFocusTracking().catch(() => {});
  } else {
    api.resumeFocusTracking().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Duplicate indicator sync
// ---------------------------------------------------------------------------

browser.tabs.onCreated.addListener(() => {
  api.syncDuplicates();
});

browser.tabs.onRemoved.addListener(() => {
  api.syncDuplicates();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    api.syncDuplicates();
  }
});

// ---------------------------------------------------------------------------
// Tab manipulation helpers
//
// goToPreviousTab and goToParentTab live in the experiment API (chrome
// context with cross-workspace switching). The helpers below need standard
// browser.tabs and depend on Zen's "essential" tab classification.
// ---------------------------------------------------------------------------

async function moveTabToStart() {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  const allTabs = await browser.tabs.query({ currentWindow: true });
  const essentialIds = new Set(await api.getEssentialTabIds());

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
    const essentialIds = new Set(await api.getEssentialTabIds());
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
  await api.scrollCurrentTabIntoView();
}

async function unloadActiveTab() {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  const parentResult = await api.goToParentTab();
  if (!parentResult) {
    await api.goToPreviousTab();
  }

  try {
    await browser.tabs.discard(activeTab.id);
  } catch (e) {}
}

const CLOSE_AND_SELECT_NAVS = {
  // No-op navigation: just close the active tab and let the browser pick
  // the successor (matches default Cmd+W behavior).
  [MSG.CLOSE_AND_SELECT_DEFAULT]:           () => Promise.resolve(true),
  [MSG.CLOSE_AND_SELECT_PREVIOUS]:          () => api.goToPreviousTab(),
  [MSG.CLOSE_AND_SELECT_PARENT]:            () => api.goToParentTab(),
  [MSG.CLOSE_AND_SELECT_NEXT_SIBLING]:      () => api.goToNextSibling(),
  [MSG.CLOSE_AND_SELECT_PREV_SIBLING]:      () => api.goToPrevSibling(),
  [MSG.CLOSE_AND_SELECT_NEXT_VERTICAL]:     () => api.goToNextVerticalTab(),
  [MSG.CLOSE_AND_SELECT_PREV_VERTICAL]:     () => api.goToPrevVerticalTab(),
  [MSG.CLOSE_AND_SELECT_UNVISITED_NEWEST]:  () => api.activateUnvisitedNewest(),
  [MSG.CLOSE_AND_SELECT_UNVISITED_OLDEST]:  () => api.activateUnvisitedOldest(),
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

// ---------------------------------------------------------------------------
// Sort actions
// ---------------------------------------------------------------------------

async function runSortAction(actionId) {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  const allTabs = await browser.tabs.query({ currentWindow: true });
  const essentialIds = new Set(await api.getEssentialTabIds());
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

  // Comparators and group helpers come from lib/tab-sort.js.
  switch (actionId) {
    case MSG.SORT_TABS_RECENT_DESC:
      tabs.sort(compareByRecentDesc);
      break;
    case MSG.SORT_TABS_RECENT_ASC:
      tabs.sort(compareByRecentAsc);
      break;
    case MSG.SORT_TABS_DOMAIN_ALPHA:
      tabs.sort(compareByDomainAlpha);
      break;
    case MSG.SORT_TABS_DOMAIN_POP:
      tabs.sort(makeCompareByDomainPop(buildDomainCounts(tabs)));
      break;
    case MSG.SORT_TABS_AGE_ASC:
      tabs.sort(compareByAgeAsc);
      break;
    case MSG.SORT_TABS_AGE_DESC:
      tabs.sort(compareByAgeDesc);
      break;
    case MSG.SORT_TABS_INACTIVE_BOTTOM:
      tabs.sort(compareInactiveBottom);
      break;
    case MSG.SORT_TABS_MOST_VISITED: {
      const uniqueUrls = [...new Set(tabs.map((t) => t.url))];
      const visitCounts = {};
      await Promise.all(uniqueUrls.map((url) =>
        browser.history.getVisits({ url }).then(
          (visits) => { visitCounts[url] = visits.length; },
          () => { visitCounts[url] = 0; }
        )
      ));
      tabs.sort(makeCompareByVisits(visitCounts));
      break;
    }
    case MSG.SORT_TABS_GROUP_DUPS: {
      const grouped = groupDuplicatesFirst(tabs);
      tabs.length = 0;
      tabs.push(...grouped);
      break;
    }
  }

  await browser.tabs.move(tabs.map((t) => t.id), { index: startIndex });
}

// ---------------------------------------------------------------------------
// Action dispatch table
//
// Single source of truth for "what does this message-type do?". Used by
// both the runtime.onMessage listener (with a hide-palette prelude) and
// runChordAction (which fires shortcuts directly without opening the
// palette). Each handler takes the message object and returns a promise.
// ---------------------------------------------------------------------------

async function getActiveTabInfo() {
  const allTabs = await api.getAllTabs();
  const activeTab = allTabs.find((t) => t.active);
  return { hasParent: !!(activeTab && activeTab.openerTabDomId) };
}

function getRecentlyClosed() {
  return browser.sessions.getRecentlyClosed({ maxResults: 25 }).then((sessions) =>
    sessions
      .filter((s) => s.tab)
      .map((s) => ({
        sessionId: s.tab.sessionId,
        title: s.tab.title || "",
        url: s.tab.url || "",
        favIconUrl: s.tab.favIconUrl || "",
        // sessions.getRecentlyClosed surfaces the original pinned state
        // (when available) but never the Zen `zen-essential` attribute,
        // so essentials show as merely pinned in the recently-closed list.
        pinned: !!s.tab.pinned,
        lastModified: s.lastModified || 0,
      }))
  );
}

const ACTIONS = Object.freeze({
  [MSG.OPEN_OPTIONS]:                     ()  => openOptions(),
  [MSG.ACTIVATE_TAB]:                     (m) => api.activateTabByDomId(m.domId),
  [MSG.GO_TO_PREVIOUS_TAB]:               ()  => api.goToPreviousTab(),
  [MSG.GO_TO_PARENT_TAB]:                 ()  => api.goToParentTab(),
  [MSG.MOVE_TAB_TO_START]:                ()  => moveTabToStart(),
  [MSG.MOVE_TAB_TO_END]:                  ()  => moveTabToEnd(),
  [MSG.SCROLL_TO_CURRENT_TAB]:            ()  => scrollToCurrentTab(),
  [MSG.UNLOAD_TAB]:                       ()  => unloadActiveTab(),
  [MSG.GO_TO_NEXT_WORKSPACE]:             ()  => api.goToNextWorkspace(),
  [MSG.GO_TO_PREV_WORKSPACE]:             ()  => api.goToPrevWorkspace(),
  [MSG.TOGGLE_PIN_TAB]:                   ()  => api.togglePinTab(),
  [MSG.COPY_URL_MARKDOWN]:                ()  => api.copyCurrentUrlMarkdown(),
  [MSG.RESTORE_LAST_CLOSED_TAB]:          ()  => api.restoreLastClosedTab(),
  [MSG.SPLIT_NEW]:                        ()  => api.splitNew(),
  [MSG.SPLIT_CLOSE]:                      ()  => api.splitClose(),
  [MSG.SPLIT_HORIZONTAL]:                 ()  => api.splitHorizontal(),
  [MSG.SPLIT_VERTICAL]:                   ()  => api.splitVertical(),
  [MSG.GO_BACK_IN_TAB]:                   ()  => api.goBackInTab(),
  [MSG.GO_FORWARD_IN_TAB]:                ()  => api.goForwardInTab(),
  [MSG.GO_TO_NEXT_VERTICAL_TAB]:          ()  => api.goToNextVerticalTab(),
  [MSG.GO_TO_PREV_VERTICAL_TAB]:          ()  => api.goToPrevVerticalTab(),
  [MSG.RESTORE_CLOSED_TAB]:               (m) => browser.sessions.restore(m.sessionId).catch(() => {}),
  [MSG.NAVIGATE_TO_HISTORY_INDEX]:        (m) => api.navigateToHistoryIndex(m.index),
  [MSG.SWITCH_WORKSPACE]:                 (m) => api.switchTo(m.workspaceId),
  [MSG.MOVE_SELECTED_TABS_TO_WORKSPACE]:  (m) => api.moveSelectedTabsToWorkspace(m.workspaceId),

  // Close-and-select submenu — all dispatch through closeAndSelect(actionId).
  [MSG.CLOSE_AND_SELECT_DEFAULT]:         (m) => closeAndSelect(m.type),
  [MSG.CLOSE_AND_SELECT_PREVIOUS]:        (m) => closeAndSelect(m.type),
  [MSG.CLOSE_AND_SELECT_PARENT]:          (m) => closeAndSelect(m.type),
  [MSG.CLOSE_AND_SELECT_NEXT_SIBLING]:    (m) => closeAndSelect(m.type),
  [MSG.CLOSE_AND_SELECT_PREV_SIBLING]:    (m) => closeAndSelect(m.type),
  [MSG.CLOSE_AND_SELECT_NEXT_VERTICAL]:    (m) => closeAndSelect(m.type),
  [MSG.CLOSE_AND_SELECT_PREV_VERTICAL]:    (m) => closeAndSelect(m.type),
  [MSG.CLOSE_AND_SELECT_UNVISITED_NEWEST]: (m) => closeAndSelect(m.type),
  [MSG.CLOSE_AND_SELECT_UNVISITED_OLDEST]: (m) => closeAndSelect(m.type),

  // Sort actions — all dispatch through runSortAction(actionId).
  [MSG.SORT_TABS_RECENT_DESC]:            (m) => runSortAction(m.type),
  [MSG.SORT_TABS_RECENT_ASC]:             (m) => runSortAction(m.type),
  [MSG.SORT_TABS_DOMAIN_ALPHA]:           (m) => runSortAction(m.type),
  [MSG.SORT_TABS_DOMAIN_POP]:             (m) => runSortAction(m.type),
  [MSG.SORT_TABS_AGE_ASC]:                (m) => runSortAction(m.type),
  [MSG.SORT_TABS_AGE_DESC]:               (m) => runSortAction(m.type),
  [MSG.SORT_TABS_INACTIVE_BOTTOM]:        (m) => runSortAction(m.type),
  [MSG.SORT_TABS_MOST_VISITED]:           (m) => runSortAction(m.type),
  [MSG.SORT_TABS_GROUP_DUPS]:             (m) => runSortAction(m.type),

  // Page 2 — this-page operations (chrome scope via experiment API)
  [MSG.RELOAD_TAB]:                       ()  => api.reloadTab(),
  [MSG.RELOAD_SKIP_CACHE]:                ()  => api.reloadTabSkipCache(),
  [MSG.DUPLICATE_TAB]:                    ()  => api.duplicateTab(),
  [MSG.TOGGLE_READER_MODE]:               ()  => api.toggleReaderMode(),
  [MSG.VIEW_PAGE_SOURCE]:                 ()  => api.viewPageSource(),
  [MSG.VIEW_PAGE_INFO]:                   ()  => api.viewPageInfo(),
  [MSG.TOGGLE_MUTE]:                      ()  => api.toggleMute(),
  [MSG.RESET_PINNED_TAB]:                 ()  => api.resetPinnedTab(),
  [MSG.ADD_TO_ESSENTIALS]:                ()  => api.addToEssentials(),
  [MSG.TAKE_SCREENSHOT]:                  ()  => api.takeScreenshot(),
  [MSG.TOGGLE_PIP]:                       ()  => api.togglePictureInPicture(),
  [MSG.TOGGLE_FULLSCREEN]:                ()  => api.toggleFullScreen(),
  [MSG.TOGGLE_DEVTOOLS]:                  ()  => api.toggleDevTools(),
  [MSG.TOGGLE_BROWSER_TOOLBOX]:           ()  => api.toggleBrowserToolbox(),
  [MSG.OPEN_DOWNLOADS]:                   ()  => api.openDownloads(),
  [MSG.OPEN_ADDONS]:                      ()  => api.openAddons(),
  [MSG.OPEN_FIREFOX_VIEW]:                ()  => api.openFirefoxView(),
  [MSG.COPY_URL]:                         ()  => api.copyCurrentUrl(),
  [MSG.UNVISITED_NEWEST]:                 ()  => api.activateUnvisitedNewest(),
  [MSG.UNVISITED_OLDEST]:                 ()  => api.activateUnvisitedOldest(),
  [MSG.MOVE_TAB_TO_FOLDER]:               (m) => api.moveTabToFolder(m.folderId),
  [MSG.REOPEN_IN_CONTAINER]:              (m) => api.reopenInContainer(m.userContextId),

  // Profiles
  [MSG.LAUNCH_PROFILE]:                   (m) => api.launchProfile(m.name),
});

// Reply-style queries — listener returns the promise so the popup awaits
// the result. Must NOT include a hide-palette prelude (hiding the palette
// destroys the caller's content browser before it can read the response).
const QUERIES = Object.freeze({
  [MSG.GET_ALL_TABS]:                  ()  => api.getAllTabs(),
  [MSG.GET_DEFAULT_CLOSE_TARGET]:      ()  => api.getDefaultCloseTargetDomId(),
  [MSG.GET_ACTIVE_TAB_INFO]:           ()  => getActiveTabInfo(),
  [MSG.GET_NAVIGATION_HISTORY]:        ()  => api.getNavigationHistory(),
  [MSG.GET_RECENTLY_CLOSED]:           ()  => getRecentlyClosed(),
  [MSG.GET_TAB_INFO]:                  (m) => api.getTabInfo(m.domId),
  [MSG.GET_HISTORY_VISITS]:            (m) => browser.history.getVisits({ url: m.url }),
  [MSG.GET_SELECTED_TAB_DOM_IDS]:      ()  => api.getSelectedTabDomIds(),
  [MSG.GET_SELECTED_TAB_URLS]:         ()  => api.getSelectedTabUrls(),
  [MSG.GET_WORKSPACES_WITH_ICONS]:     ()  => api.getWorkspacesWithIcons(),
  [MSG.GET_FOLDERS]:                   ()  => api.getFolders(),
  [MSG.CHECK_COMPANION_MOD]:           ()  => api.getCompanionMods(),
  [MSG.INSTALL_COMPANION_MOD]:         (m) => api.installCompanionMod(m.modId),
  [MSG.REMOVE_COMPANION_MOD]:          (m) => api.removeCompanionMod(m.modId),
  [MSG.GET_PROFILES]:                  ()  => api.getProfiles(),
  [MSG.LIST_EXTENSIONS]:               ()  => api.listBrowserActionExtensions(),
});

// Synchronous fire-and-forget messages that do NOT hide the palette
// (palette UI uses these for live updates: preview hover, navigate-view,
// etc.). Kept separate from ACTIONS so we don't accidentally race the
// palette out from under the user.
const SYNC_HANDLERS = Object.freeze({
  [MSG.HIDE_PALETTE]:    ()  => api.hidePalette(),
  [MSG.NAVIGATE_VIEW]:   (m) => {
    if (!VIEW_IDS.has(m.view)) {
      console.warn("Ignoring navigate-view with unknown view:", m.view);
      return;
    }
    return api.navigateToView(m.view, m.params);
  },
  [MSG.NAVIGATE_BACK]:   ()  => api.navigateBack(),
  [MSG.PREVIEW_TAB]:     (m) => api.previewTab(m.domId),
  [MSG.CLEAR_PREVIEW]:   ()  => api.clearPreview(),
  [MSG.CLOSE_TAB]:       (m) => api.closeTabByDomId(m.domId),
  [MSG.RESTORE_CLOSED_TAB_KEEP_OPEN]: async (m) => {
    await browser.sessions.restore(m.sessionId).catch(() => {});
    // sessions.restore activates the new tab and steals focus; bring
    // focus back to the popup <browser> so arrow keys keep navigating
    // the menu and the user can chain more restores.
    await api.focusPalette().catch(() => {});
  },
  [MSG.OPEN_EXTENSION_POPUP]: (m) => api.openExtensionPopup(m.extensionId),
  [MSG.RESIZE_PANEL]:         (m) => api.resizePanel(m.view),
});

// Hide palette, then run an action. Used by the message handler to keep
// the palette responsive (closes immediately, action runs after).
async function hideAndDo(fn) {
  await api.hidePalette();
  return fn();
}

// Run an action triggered via a chord shortcut. The palette never opened
// in this path, so we skip the hide-palette prelude. Reuses the ACTIONS
// table for parity with palette-driven dispatch.
async function runChordAction(actionId) {
  const handler = ACTIONS[actionId];
  if (!handler) return;
  await handler({ type: actionId });
}

async function handleOpenPaletteRequest() {
  const result = await api.showPalette();
  if (result && result.kind === "chord-action") {
    await runChordAction(result.actionId);
  }
}

browser.commands.onCommand.addListener(async (command) => {
  if (command !== "open-palette") return;
  await handleOpenPaletteRequest();
});

// Chrome-side gesture (double-tap Cmd) — see experiment/api.js.
api.onPaletteRequest.addListener(handleOpenPaletteRequest);

// Toolbar icon click opens the palette immediately, bypassing chord-arming.
browser.browserAction.onClicked.addListener(() => {
  api.showPalette({ skipChord: true });
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message) => {
  const type = message.type;

  const query = QUERIES[type];
  if (query) return query(message);

  const action = ACTIONS[type];
  if (action) {
    hideAndDo(() => action(message));
    return;
  }

  const sync = SYNC_HANDLERS[type];
  if (sync) {
    // Return the handler's value so callers can await results (e.g.
    // navigate-back returns the previous view info so the popup can run
    // its handler locally).
    return sync(message);
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
  const urls = await api.getSelectedTabUrls();
  browser.menus.update("copy-selected-urls", { visible: urls.length > 1 });
  browser.menus.refresh();
});

browser.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "copy-selected-urls") return;
  const urls = await api.getSelectedTabUrls();
  if (urls.length > 0) {
    navigator.clipboard.writeText(urls.join("\n"));
  }
});

// ---------------------------------------------------------------------------
// Initialize — populate the settings cache, trigger experiment API load
// (it's lazy, only loads on first access), and start the duplicate sync.
// ---------------------------------------------------------------------------

loadSettings();
api.getActiveWorkspaceId().catch(() => {});
api.syncDuplicates().catch(() => {});
api.initTabTracking().catch(() => {});

// Show welcome page on first install
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const { welcomed } = await browser.storage.local.get({ welcomed: STORAGE_DEFAULTS.welcomed });
    if (!welcomed) {
      await browser.storage.local.set({ welcomed: true });
      browser.tabs.create({ url: browser.runtime.getURL("welcome/welcome.html") });
    }
  }
});
