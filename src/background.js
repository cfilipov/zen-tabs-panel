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
const CHORD_REFACTOR_RESTART_VERSION = "0.4.4";

function compareVersions(a, b) {
  const left = String(a || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

function shouldShowChordRestartNotice(previousVersion, currentVersion) {
  return (
    compareVersions(previousVersion, CHORD_REFACTOR_RESTART_VERSION) < 0 &&
    compareVersions(currentVersion, CHORD_REFACTOR_RESTART_VERSION) >= 0
  );
}

function welcomeUrl(params) {
  const query = new URLSearchParams(params || {});
  const suffix = query.toString();
  return browser.runtime.getURL("welcome/welcome.html" + (suffix ? "?" + suffix : ""));
}

async function loadSettings() {
  const stored = await browser.storage.local.get(STORAGE_DEFAULTS);
  Object.assign(settings, stored);
  syncAutoCloseAlarm();
  pushInterceptSetting();
  pushActionPopupCaptureSetting();
  pushSkipAnimationsSetting();
  pushDimBackdropSetting();
  pushDuplicateInterceptSetting();
  pushChordDelaySetting();
}

function pushInterceptSetting() {
  api.setExtensionPopupIntercept(!!settings.interceptExtensionPopups).catch(() => {});
}

function pushActionPopupCaptureSetting() {
  api.setExtensionActionPopupCapture(!!settings.captureExtensionActionPopups).catch(() => {});
}

function pushSkipAnimationsSetting() {
  api.setSkipOverlayAnimations(!!settings.skipOverlayAnimations).catch(() => {});
}

function pushDimBackdropSetting() {
  api.setDimBackdrop(!!settings.dimBackdrop).catch(() => {});
}

function pushDuplicateInterceptSetting() {
  api.setDuplicateTabIntercept(!!settings.duplicateTabIntercept).catch(() => {});
}

function pushChordDelaySetting() {
  const ms = Number(settings.chordDelayMs);
  if (Number.isFinite(ms) && ms >= 0) {
    api.setChordDelay(ms).catch(() => {});
  }
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  let autoCloseTouched = false;
  let interceptTouched = false;
  let actionPopupCaptureTouched = false;
  let skipAnimationsTouched = false;
  let dimBackdropTouched = false;
  let dupInterceptTouched = false;
  let chordDelayTouched = false;
  for (const key of Object.keys(changes)) {
    if (key in STORAGE_DEFAULTS) {
      settings[key] = changes[key].newValue ?? STORAGE_DEFAULTS[key];
      if (key === "autoCloseEnabled") autoCloseTouched = true;
      if (key === "interceptExtensionPopups") interceptTouched = true;
      if (key === "captureExtensionActionPopups") actionPopupCaptureTouched = true;
      if (key === "skipOverlayAnimations") skipAnimationsTouched = true;
      if (key === "dimBackdrop") dimBackdropTouched = true;
      if (key === "duplicateTabIntercept") dupInterceptTouched = true;
      if (key === "chordDelayMs") chordDelayTouched = true;
    }
  }
  if (autoCloseTouched) syncAutoCloseAlarm();
  if (interceptTouched) pushInterceptSetting();
  if (actionPopupCaptureTouched) pushActionPopupCaptureSetting();
  if (skipAnimationsTouched) pushSkipAnimationsSetting();
  if (dimBackdropTouched) pushDimBackdropSetting();
  if (dupInterceptTouched) pushDuplicateInterceptSetting();
  if (chordDelayTouched) pushChordDelaySetting();
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

  const cutoff = now - threshold;

  // Use the experiment-owned tab index so the background sweep transfers
  // only close targets, not a rich snapshot of every tab in every workspace.
  let tabs;
  try {
    tabs = await api.getAutoCloseCandidates(cutoff);
  } catch (e) {
    // Fallback to standard API (current workspace only)
    tabs = await browser.tabs.query({ pinned: false });
  }

  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (tab.active) continue;
    if (now - tab.lastAccessed > threshold) {
      try {
        if (tab.domId) await api.closeTabByDomId(tab.domId);
        else if (tab.id != null) await browser.tabs.remove(tab.id);
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

// Resolve the multi-selection (or just the active tab if no multi-select)
// to a list of tabs paired with their current state, filtered to whatever
// pinned-status the active tab has so that move-to-start / move-to-end
// stays within the active's section (active pinned → move pinned ones;
// active unpinned → move unpinned ones). Essentials are always excluded.
async function getMoveTargetSet() {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return null;
  const essentialIds = new Set(await api.getEssentialTabIds());
  if (essentialIds.has(activeTab.id)) return null;
  const targetIds = new Set(await api.getActionTargetExtIds());
  const allTabs = await browser.tabs.query({ currentWindow: true });
  const cohort = allTabs.filter((t) =>
    targetIds.has(t.id) &&
    !essentialIds.has(t.id) &&
    t.pinned === activeTab.pinned
  );
  return { activeTab, allTabs, essentialIds, cohort };
}

async function moveTabToStart() {
  const ctx = await getMoveTargetSet();
  if (!ctx || ctx.cohort.length === 0) return;
  const { activeTab, allTabs, essentialIds, cohort } = ctx;
  let targetIndex;
  if (activeTab.pinned) {
    const firstNonEssentialPinned = allTabs.find((t) => t.pinned && !essentialIds.has(t.id));
    targetIndex = firstNonEssentialPinned ? firstNonEssentialPinned.index : 0;
  } else {
    const firstUnpinned = allTabs.find((t) => !t.pinned);
    targetIndex = firstUnpinned ? firstUnpinned.index : 0;
  }
  // Sort by current index so relative order is preserved at the new
  // position. browser.tabs.move accepts an array and inserts them
  // contiguously starting at `index`.
  const ids = cohort.sort((a, b) => a.index - b.index).map((t) => t.id);
  await browser.tabs.move(ids, { index: targetIndex });
}

async function moveTabToEnd() {
  const ctx = await getMoveTargetSet();
  if (!ctx || ctx.cohort.length === 0) return;
  const { activeTab, allTabs, cohort } = ctx;
  let targetIndex;
  if (activeTab.pinned) {
    const pinnedTabs = allTabs.filter((t) => t.pinned);
    targetIndex = pinnedTabs.length > 0 ? pinnedTabs[pinnedTabs.length - 1].index : 0;
  } else {
    targetIndex = -1;
  }
  const ids = cohort.sort((a, b) => a.index - b.index).map((t) => t.id);
  await browser.tabs.move(ids, { index: targetIndex });
}

async function scrollToCurrentTab() {
  await api.scrollCurrentTabIntoView();
}

async function unloadActiveTab() {
  const [targetIds, targetDomIds] = await Promise.all([
    api.getActionTargetExtIds(),
    api.getActionTargetDomIds(),
  ]);
  if (!Array.isArray(targetIds) || targetIds.length === 0) return;
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

  // Discarding the active tab needs to deactivate it first — pick a
  // successor that's NOT in the unload set (parent first, then any
  // most-recent non-set tab).
  if (activeTab && targetIds.includes(activeTab.id)) {
    const parentOk = await api.goToParentTab(targetDomIds);
    if (!parentOk) {
      await api.goToPreviousTab(targetDomIds);
    }
  }

  for (const id of targetIds) {
    try { await browser.tabs.discard(id); } catch (e) {}
  }
}

// Each entry takes the about-to-close set's DOM ids and picks a
// successor that's NOT in that set — used so multi-close from the
// sidebar doesn't try to "go to next vertical" and land on the next
// tab that's also being closed.
const CLOSE_AND_SELECT_NAVS = {
  // No-op navigation: let the browser pick the successor (matches
  // default Cmd+W behavior). Multi-close just removes the cohort and
  // Firefox picks a successor for the active tab's slot.
  [MSG.CLOSE_AND_SELECT_DEFAULT]:           ()       => Promise.resolve(true),
  [MSG.CLOSE_AND_SELECT_PREVIOUS]:          (excl)   => api.goToPreviousTab(excl),
  [MSG.CLOSE_AND_SELECT_PARENT]:            (excl)   => api.goToParentTab(excl),
  [MSG.CLOSE_AND_SELECT_NEXT_SIBLING]:      (excl)   => api.goToNextSibling(excl),
  [MSG.CLOSE_AND_SELECT_PREV_SIBLING]:      (excl)   => api.goToPrevSibling(excl),
  [MSG.CLOSE_AND_SELECT_NEXT_VERTICAL]:     (excl)   => api.goToNextVerticalTab(excl),
  [MSG.CLOSE_AND_SELECT_PREV_VERTICAL]:     (excl)   => api.goToPrevVerticalTab(excl),
  [MSG.CLOSE_AND_SELECT_UNVISITED_NEWEST]:  (excl)   => api.activateUnvisitedNewest(excl),
  [MSG.CLOSE_AND_SELECT_UNVISITED_OLDEST]:  (excl)   => api.activateUnvisitedOldest(excl),
};

async function closeAndSelect(actionId) {
  const navFn = CLOSE_AND_SELECT_NAVS[actionId];
  if (!navFn) return;
  // The whole multi-selection is closed (active + co-selected) and the
  // navigator excludes those when picking the successor. Falls back to
  // the default close behavior if no surviving target exists in the
  // requested direction.
  const [extIds, domIds] = await Promise.all([
    api.getActionTargetExtIds(),
    api.getActionTargetDomIds(),
  ]);
  if (!Array.isArray(extIds) || extIds.length === 0) return;
  // Pinned tabs (essentials) are excluded from action-target sets, but
  // still guard the active tab's pinned status — closing pinned tabs
  // is intentionally blocked.
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.pinned) return;
  try { await navFn(domIds); } catch (e) {}
  await browser.tabs.remove(extIds);
}

async function openOptions() {
  browser.runtime.openOptionsPage();
}

// ---------------------------------------------------------------------------
// Sort actions
// ---------------------------------------------------------------------------

async function forEachWithConcurrency(items, limit, fn) {
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }));
}

async function runSortAction(actionId) {
  let visitCounts = {};
  if (actionId === MSG.SORT_TABS_MOST_VISITED) {
    const uniqueUrls = await api.getReorderTabUrls();
    await forEachWithConcurrency(uniqueUrls, 32, async (url) => {
      await browser.history.getVisits({ url }).then(
        (visits) => { visitCounts[url] = visits.length; },
        () => { visitCounts[url] = 0; }
      );
    });
  }
  await api.sortTabs(actionId, JSON.stringify(visitCounts));
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
  const activeTab = await api.getActiveRow();
  return { hasParent: !!(activeTab && (activeTab.openerTabDomId || activeTab.panelParentUuid)) };
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

function emptyTabInfoViewModel() {
  return {
    info: null,
    visits: [],
    duplicates: [],
    workspaces: [],
    selectedIndex: -1,
  };
}

async function getTabInfoViewModel() {
  const active = await api.getActiveRow();
  if (!active) return emptyTabInfoViewModel();

  const info = await api.getTabInfo(active.domId);
  if (!info) return emptyTabInfoViewModel();

  const titleByUrl = new Map();
  for (const entry of info.sessionEntries || []) {
    if (entry.url && !titleByUrl.has(entry.url)) titleByUrl.set(entry.url, entry.title);
  }
  if (info.url && !titleByUrl.has(info.url)) titleByUrl.set(info.url, info.title);

  const urls = new Set();
  if (info.url && !info.url.startsWith("about:")) urls.add(info.url);
  for (const entry of info.sessionEntries || []) {
    if (entry.url && !entry.url.startsWith("about:")) urls.add(entry.url);
  }

  const [visitLists, workspaces, duplicates] = await Promise.all([
    Promise.all(Array.from(urls).map((url) => browser.history.getVisits({ url }).then(
      (visits) => visits.map((visit) => ({ ...visit, url, title: titleByUrl.get(url) || url })),
      () => []
    ))),
    api.getWorkspacesWithIcons().catch(() => []),
    info.duplicateDomIds?.length ? api.getRowsByDomIds(JSON.stringify(info.duplicateDomIds)) : [],
  ]);

  return {
    info,
    visits: visitLists.flat(),
    duplicates,
    workspaces,
    selectedIndex: -1,
  };
}

async function restoreClosedSession(sessionId) {
  const restored = await browser.sessions.restore(sessionId).catch(() => null);
  const tabId = restored && restored.tab && restored.tab.id;
  if (typeof tabId === "number") {
    await api.markTabNewByExtId(tabId).catch(() => {});
  }
  return restored;
}

async function restoreRecentlyClosedByIndex(index, expectedSessionId) {
  const rowIndex = Number(index);
  if (!Number.isInteger(rowIndex) || rowIndex < 0) return false;
  const rows = await getRecentlyClosed().catch(() => []);
  const row = rows[rowIndex];
  if (!row || !row.sessionId) return false;
  if (expectedSessionId && row.sessionId !== expectedSessionId) return false;
  await restoreClosedSession(row.sessionId);
  return true;
}

const ACTIONS = Object.freeze({
  [MSG.OPEN_OPTIONS]:                     ()  => openOptions(),
  [MSG.REPLAY_LAST_CHORD]:                ()  => replayLastChord(),
  [MSG.DUPLICATE_SWITCH]:                 ()  => handleDuplicateSwitch(),
  [MSG.DUPLICATE_OPEN_ANYWAY]:            ()  => handleDuplicateOpenAnyway(),
  [MSG.DUPLICATE_OPEN_AND_CLOSE_OTHERS]:  ()  => handleDuplicateOpenAndCloseOthers(),
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
  [MSG.RESTORE_CLOSED_TAB]:               (m) => restoreClosedSession(m.sessionId),
  [MSG.RESTORE_CLOSED_TAB_BY_INDEX]:      (m) => restoreRecentlyClosedByIndex(m.index, m.expectedRowId),
  [MSG.NAVIGATE_TO_HISTORY_INDEX]:        (m) => api.navigateToHistoryIndex(m.index),
  [MSG.SWITCH_WORKSPACE]:                 (m) => api.switchTo(m.workspaceId),
  [MSG.MOVE_SELECTED_TABS_TO_WORKSPACE]:  (m) => api.moveSelectedTabsToWorkspace(m.workspaceId, !!m.switchToTarget),

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
  [MSG.REPLACE_PINNED_URL]:               ()  => api.replacePinnedUrl(),
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
  [MSG.MOVE_TAB_TO_FOLDER]:               (m) => api.moveTabToFolder(m.folderId, !!m.switchToTarget),
  [MSG.REOPEN_IN_CONTAINER]:              (m) => api.reopenInContainer(m.userContextId),

  // Profiles
  [MSG.LAUNCH_PROFILE]:                   (m) => api.launchProfile(m.name),
});

// Reply-style queries — listener returns the promise so the popup awaits
// the result. Must NOT include a hide-palette prelude (hiding the palette
// destroys the caller's content browser before it can read the response).
const QUERIES = Object.freeze({
  // Popup signals it has wired its document keydown listener. The reply is
  // { buffered, view, armRevealTimer }: buffered contains any keys captured
  // while the hidden popup was loading, and the popup replays them before
  // processing live input.
  [MSG.POPUP_READY]:                   (m) => api.takeChordBridgeBuffer(m && typeof m.inst === "number" ? m.inst : null),
  [MSG.REVEAL_PALETTE]:                (m) => api.revealPalette(m && typeof m.inst === "number" ? m.inst : null),
  [MSG.GET_DEFAULT_CLOSE_TARGET]:      ()  => api.getDefaultCloseTargetDomId(),
  [MSG.GET_ACTIVE_TAB_INFO]:           ()  => getActiveTabInfo(),
  [MSG.GET_NAVIGATION_HISTORY]:        ()  => api.getNavigationHistory(),
  [MSG.GET_RECENTLY_CLOSED]:           ()  => getRecentlyClosed(),
  [MSG.GET_TAB_INFO_VIEW_MODEL]:       ()  => getTabInfoViewModel(),
  [MSG.GET_SELECTED_TAB_DOM_IDS]:      ()  => api.getSelectedTabDomIds(),
  [MSG.GET_SELECTED_TAB_URLS]:         ()  => api.getSelectedTabUrls(),
  [MSG.GET_WORKSPACES_WITH_ICONS]:     ()  => api.getWorkspacesWithIcons(),
  [MSG.GET_WORKSPACES_VIEW_MODEL]:     ()  => api.getWorkspacesViewModel(),
  [MSG.SET_ACTIVE_WORKSPACE_ICON]:     (m) => api.setActiveWorkspaceIcon(m.iconName || ""),
  [MSG.TAB_INDEX_ENSURE_STARTED]:      ()  => api.ensureIndexStarted(),
  [MSG.TAB_INDEX_GET_VERSION]:         ()  => api.getIndexVersion(),
  [MSG.TAB_INDEX_GET_SUMMARY]:         (m) => api.getViewSummary(m.view, JSON.stringify(m.params || {})),
  [MSG.TAB_INDEX_GET_WINDOW]:          (m) => api.getViewWindow(m.view, m.offset || 0, m.limit || 50, JSON.stringify(m.params || {})),
  [MSG.TAB_INDEX_GET_RECENTS_MODEL]:   (m) => api.getRecentsViewModel(m.offset || 0, m.limit || 50, JSON.stringify(m.params || {})),
  [MSG.TAB_INDEX_GET_ROW_TARGET]:      (m) => api.getRowTarget(m.domId),
  [MSG.TAB_INDEX_GET_ACTIVE_ROW]:      ()  => api.getActiveRow(),
  [MSG.TAB_INDEX_GET_ROWS_BY_DOM_IDS]: (m) => api.getRowsByDomIds(JSON.stringify(m.domIds || [])),
  [MSG.TAB_INDEX_GET_WORKSPACE_COUNTS]: () => api.getWorkspaceTabCounts(),
  [MSG.TAB_INDEX_GET_ACTIONS_MODEL]:    async () => {
    const recentlyClosed = await getRecentlyClosed().catch(() => []);
    return api.getActionsViewModel(recentlyClosed.length);
  },
  [MSG.TAB_INDEX_GET_DUPLICATE_GROUPS_MODEL]: (m) => api.getDuplicateGroupsViewModel(m.workspaceFilter || "all"),
  [MSG.TAB_INDEX_GET_DUPLICATE_PROMPT_MODEL]: (m) => api.getDuplicatePromptViewModel(m.url || "", m.domId || null),
  [MSG.GET_CONTAINERS_VIEW_MODEL]:     ()  => api.getContainersViewModel(),
  [MSG.GET_FOLDERS_VIEW_MODEL]:        ()  => api.getFoldersViewModel(),
  [MSG.CHECK_COMPANION_MOD]:           ()  => api.getCompanionMods(),
  [MSG.INSTALL_COMPANION_MOD]:         (m) => api.installCompanionMod(m.modId),
  [MSG.REMOVE_COMPANION_MOD]:          (m) => api.removeCompanionMod(m.modId),
  [MSG.GET_PROFILES_VIEW_MODEL]:       ()  => api.getProfilesViewModel(),
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
  [MSG.RESTART_ZEN]:     ()  => api.restartZen(),
  [MSG.PREVIEW_TAB]:     (m) => api.previewTab(m.domId),
  [MSG.CLEAR_PREVIEW]:   ()  => api.clearPreview(),
  [MSG.CLOSE_TAB]:       (m) => api.closeTabByDomId(m.domId),
  [MSG.RESTORE_CLOSED_TAB_KEEP_OPEN]: async (m) => {
    await restoreClosedSession(m.sessionId);
    // sessions.restore activates the new tab and steals focus; bring
    // focus back to the popup <browser> so arrow keys keep navigating
    // the menu and the user can chain more restores.
    await api.focusPalette().catch(() => {});
  },
  [MSG.OPEN_EXTENSION_POPUP]: (m) => api.openExtensionPopup(m.extensionId),
  [MSG.OPEN_EXTENSION_POPUP_BY_INDEX]: (m) => api.openExtensionPopupByIndex(m.index),
  [MSG.SWITCH_WORKSPACE_BY_INDEX]: async (m) => {
    const ok = await api.switchWorkspaceByIndex(m.index);
    if (ok) {
      await api.hidePalette();
    }
    return ok;
  },
  [MSG.ACTIVATE_CURRENT_VIEW_ROW]: async (m) => {
    const result = await api.activateCurrentViewRow(
      m.index,
      m.source,
      !!m.switchToTarget,
      m.listVersion,
      m.chordKey || "",
      m.activation || null,
      m.expectedRowId || "",
    );
    if (result && typeof result === "object" && result.kind === "open-view") {
      return result;
    }
    await api.hidePalette();
    return result;
  },
  [MSG.RESIZE_PANEL]:         (m) => api.resizePanel(m.view, m.height, m.dynamicSidebarWidth, m.inst),
  [MSG.BRIDGE_DISPATCH_SETTLED]: (m) => api.bridgeDispatchSettled(m.inst),
});

// Hide palette, then run an action. Used by the message handler to keep
// the palette responsive (closes immediately, action runs after).
async function hideAndDo(fn) {
  await api.hidePalette();
  return fn();
}

function recordRuntimeActionReplay(message) {
  if (!message || !message.type) return;
  if (message.type === MSG.REPLAY_LAST_CHORD) return;
  // Duplicate-prompt outcomes are context-bound to the in-flight
  // openLinkIn intercept — replaying them does nothing useful (and
  // would mask the previous replayable chord by overwriting chrome's
  // chord-chain context.
  if (
    message.type === MSG.DUPLICATE_SWITCH ||
    message.type === MSG.DUPLICATE_OPEN_ANYWAY ||
    message.type === MSG.DUPLICATE_OPEN_AND_CLOSE_OTHERS
  ) return;
  // Let chrome decide whether this terminal action commits a chord chain
  // (open-view + bridge keys -> cycling replay) or just gets recorded as a
  // plain action. Chord-chain state lives in ChordSession; runtime action
  // dispatch still happens here in background.
  try { api.recordRuntimeActionForReplay(message).catch(() => {}); } catch (e) {}
}

// Run an action triggered via a chord shortcut. The palette never opened
// in this path, so we skip the hide-palette prelude. Reuses the ACTIONS
// table for parity with palette-driven dispatch.
async function runChordAction(actionId) {
  const handler = ACTIONS[actionId];
  if (!handler) return;
  const message = { type: actionId };
  recordRuntimeActionReplay(message);
  await handler(message);
}

// Replay-last-chord (cmd+.,.). ChordSession owns both chord traces and
// raw runtime action-message traces; background only executes the replayed
// runtime action when chrome sends it back through handleChordResult.
async function replayLastChord() {
  try {
    await api.replayLastChord();
  } catch (e) {}
}

async function handleChordResult(result) {
  if (result && result.kind === "chord-action") {
    await runChordAction(result.actionId);
  } else if (result && result.kind === "runtime-action") {
    const message = result.message;
    const handler = message && ACTIONS[message.type];
    if (handler) await handler(message);
  } else if (result && result.kind === "restore-recently-closed-index") {
    await restoreRecentlyClosedByIndex(result.index, result.expectedSessionId);
  } else if (result && result.kind === "duplicate-content-link") {
    if (typeof result.tabId !== "number" || typeof result.url !== "string" || typeof result.dupDomId !== "string") {
      return;
    }
    webRequestPendingDuplicate = {
      tabId: result.tabId,
      url: result.url,
      dupDomId: result.dupDomId,
    };
    try {
      const confirmedDomId = await api.showDuplicatePrompt(result.url, result.tabId);
      if (!confirmedDomId) {
        webRequestPendingDuplicate = null;
      } else {
        webRequestPendingDuplicate.dupDomId = confirmedDomId;
      }
    } catch (e) {
      webRequestPendingDuplicate = null;
    }
  }
}

// Configurable chord-leader shortcuts. The manifest declares four
// open-palette commands; each one is a separate Firefox-keyset entry
// that can be customized independently in about:addons. All call the
// same armChord — they're alternates, so users can pick whichever
// modifier is least likely to be eaten by the focused page. Defaults:
//   open-palette    cmd+.
//   open-palette-2  cmd+option+.
//   open-palette-3  (unset)
//   open-palette-4  (unset)
// armChord arms ChordSession plus the chrome/content capture shims. Content
// keys are suppressed in-process by the shim and forwarded to chrome for
// traversal.
browser.commands.onCommand.addListener((command) => {
  if (command.startsWith("open-palette")) {
    api.armChord().catch(() => {});
  }
});

// ChordSession fires terminal chord results back via this event. We dispatch
// the resulting action (if any).
api.onPaletteRequest.addListener(handleChordResult);

// ---------------------------------------------------------------------------
// Duplicate-link interceptor for same-tab navigation
//
// Plain left-clicks on links navigate in the content process without
// calling chrome's openLinkIn, so the chrome-side hook in api.js
// doesn't catch them. webRequest.onBeforeRequest with blocking is the
// only place we can both detect AND cancel that nav before it
// commits. We skip when the request originates from a newly-opened
// tab (about:blank / about:newtab), since those are openLinkIn's
// territory and handling them here would create a flash where the
// new tab opens then we cancel.
// ---------------------------------------------------------------------------

let webRequestPendingDuplicate = null; // { tabId, url, dupDomId }
// One-shot pass for the next webRequest matching {tabId,url}. Set by
// "Open anyway" so the resulting browser.tabs.update doesn't re-trip
// the duplicate detector and re-pop the prompt forever.
let allowOnce = null; // { tabId, url }

function duplicateNavigationUrlsMatch(candidateUrl, openTabUrl) {
  if (typeof isDuplicateNavigationUrl === "function") {
    return !!isDuplicateNavigationUrl(candidateUrl, openTabUrl);
  }
  return candidateUrl === openTabUrl;
}

// Duplicate-prompt outcomes route here so we can pick between the bg
// (webRequest, same-tab) path and the chrome (openLinkIn, new-tab)
// path. Whichever has state set wins; if both are clear we just
// dismiss the overlay.
async function handleDuplicateSwitch() {
  if (webRequestPendingDuplicate) {
    const { dupDomId } = webRequestPendingDuplicate;
    webRequestPendingDuplicate = null;
    try { await api.activateTabByDomId(dupDomId); } catch (e) {}
    await api.hidePalette();
    return;
  }
  await api.duplicateSwitch();
}

async function handleDuplicateOpenAnyway() {
  if (webRequestPendingDuplicate) {
    const { tabId, url } = webRequestPendingDuplicate;
    webRequestPendingDuplicate = null;
    allowOnce = { tabId, url };
    try { await api.approveDuplicateNavigation(url, tabId); } catch (e) {}
    try { await browser.tabs.update(tabId, { url }); } catch (e) { allowOnce = null; }
    await api.hidePalette();
    return;
  }
  await api.duplicateOpenAnyway();
}

async function handleDuplicateOpenAndCloseOthers() {
  if (webRequestPendingDuplicate) {
    const { tabId, url } = webRequestPendingDuplicate;
    webRequestPendingDuplicate = null;
    allowOnce = { tabId, url };
    try { await api.approveDuplicateNavigation(url, tabId); } catch (e) {}
    try {
      await api.closeDuplicateTabsForUrl(url, tabId);
      await browser.tabs.update(tabId, { url });
    } catch (e) {
      allowOnce = null;
    }
    await api.hidePalette();
    return;
  }
  await api.duplicateOpenAndCloseOthers();
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!settings.duplicateTabIntercept) return {};
    if (details.tabId < 0) return {};
    if (details.frameId !== 0) return {};
    if (!/^https?:/.test(details.url)) return {};
    // One-shot bypass for the very navigation the user just chose to
    // "Open anyway" — without this we'd intercept the same URL again
    // and the prompt would loop.
    if (allowOnce && allowOnce.tabId === details.tabId && duplicateNavigationUrlsMatch(details.url, allowOnce.url)) {
      allowOnce = null;
      return {};
    }
    return (async () => {
      try {
        const navigatingTab = await browser.tabs.get(details.tabId);
        // Brand-new tab opening: leave it to openLinkIn / let through.
        if (!navigatingTab || !navigatingTab.url ||
            navigatingTab.url === "about:newtab" ||
            navigatingTab.url === "about:blank" ||
            navigatingTab.url === "about:home") {
          return {};
        }
        if (isSameMainFrameNavigationUrl(navigatingTab.url, details.url)) return {};

        const dupDomId = await api.showDuplicatePrompt(details.url, details.tabId, true);
        if (!dupDomId) return {};
        webRequestPendingDuplicate = {
          tabId: details.tabId,
          url: details.url,
          dupDomId,
        };
        return { cancel: true };
      } catch (e) {
        return {};
      }
    })();
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
  ["blocking"]
);

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
    recordRuntimeActionReplay(message);
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

// Show welcome/update page when the user should see setup or migration notes.
browser.runtime.onInstalled.addListener(async (details) => {
  const currentVersion = browser.runtime.getManifest().version;
  if (details.reason === "install") {
    const { welcomed } = await browser.storage.local.get({ welcomed: STORAGE_DEFAULTS.welcomed });
    if (!welcomed) {
      await browser.storage.local.set({ welcomed: true });
      browser.tabs.create({ url: welcomeUrl() });
    }
  } else if (
    details.reason === "update" &&
    shouldShowChordRestartNotice(details.previousVersion, currentVersion)
  ) {
    browser.tabs.create({
      url: welcomeUrl({
        mode: "update",
        from: details.previousVersion || "",
        to: currentVersion,
        restart: "1",
      }),
    });
  }
});
