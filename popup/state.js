"use strict";

// Mutable popup state, grouped by concern. All popup scripts share the
// same script-global lexical scope, so reads and writes to these objects
// work cross-file without any wiring.
//
// Loaded as a <script> tag in popup.html before render.js and popup.js so
// the bindings exist before any view code runs.

// UI / navigation state.
const ui = {
  currentView: "actions",
  selectedIndex: -1,
  items: [],
  sectionStarts: [],
  sidebarFocused: false,
  sidebarSelectedIndex: -1,
};

// Per-tab counts and previews shown in the actions menu.
const tabState = {
  currentTabHasParent: false,
  childTabCount: 0,
  unvisitedTabCount: 0,
  parentTabPreview: null,    // { title, favIconUrl }
  previousTabPreview: null,  // { title, favIconUrl }
  backPreview: null,         // { title, url, isHistory: true }
  forwardPreview: null,      // { title, url, isHistory: true }
  nextVerticalPreview: null, // { title, favIconUrl, domId, workspaceId }
  prevVerticalPreview: null, // same shape
  selectedTabCount: 0,
  duplicateGroupCount: 0,
  siblingTabCount: 0,
  parentTabCount: 0,
  domainCount: 0,
  recentlyClosedCount: 0,
  navigationHistoryCount: 0,
  currentDomain: null,
  tabsByAgeNewestFirst: false,
  domainsSortAlpha: false,
  workspaceTabCounts: {},
};

// Workspace state — populated lazily when a view needs it.
const wsState = {
  workspaceMap: {},        // uuid → { name, svgContent }
  activeWorkspaceId: null,
  workspaceFilter: "all",
};

// View registry — populated by popup/views/*.js. Each entry maps a view id
// (the same string used in URL ?view=, init(), and ui.currentView) to a
// thunk `(params) => Promise<void>`. Object.create(null) for prototype-
// free lookup on the keyboard hot path.
const VIEWS = Object.create(null);

// ---------------------------------------------------------------------------
// getAllTabs cache
//
// The chrome-side `getAllTabs` walks every tabbrowser-tab DOM element and
// builds a 500-tab array — measured at ~3.3ms per call on a 954-tab session,
// plus IPC overhead each direction. Many popup views call it back-to-back
// (actions menu, then user drills into a sub-view). A short TTL skips the
// redundant work without risking obviously-stale data.
//
// 500ms is far longer than a chained view transition takes but well below
// any noticeable UI staleness. The popup is short-lived anyway — the cache
// dies when the palette closes.
// ---------------------------------------------------------------------------

const ALL_TABS_CACHE_TTL_MS = 500;
let _allTabsCache = null;
let _allTabsCacheAt = 0;
let _allTabsInflight = null;

function getAllTabsCached() {
  const now = Date.now();
  if (_allTabsCache && (now - _allTabsCacheAt) < ALL_TABS_CACHE_TTL_MS) {
    return Promise.resolve(_allTabsCache);
  }
  if (_allTabsInflight) return _allTabsInflight;
  const ext = typeof browser !== "undefined" ? browser : chrome;
  _allTabsInflight = ext.runtime.sendMessage({ type: "get-all-tabs" }).then(
    (tabs) => {
      _allTabsCache = tabs;
      _allTabsCacheAt = Date.now();
      _allTabsInflight = null;
      return tabs;
    },
    (err) => {
      _allTabsInflight = null;
      throw err;
    }
  );
  return _allTabsInflight;
}

function invalidateAllTabsCache() {
  _allTabsCache = null;
  _allTabsCacheAt = 0;
}
