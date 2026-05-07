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
