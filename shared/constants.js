"use strict";

// Cross-context constants shared by popup, options, welcome, and background.
//
// Loaded by:
//   - popup/popup.html, options/options.html, welcome/welcome.html
//     via <script src="../shared/constants.js">
//   - background.js via the "background.scripts" array in manifest.json
//
// The `this.X = ...` pattern follows shared/keybindings.js so the same file
// works under both <script> tags (this === window) and any future
// loadSubScript scope.

// Message type strings exchanged via browser.runtime.sendMessage between
// content contexts (popup/options/welcome) and background.js.
this.MSG = Object.freeze({
  // Palette lifecycle
  HIDE_PALETTE:                   "hide-palette",
  NAVIGATE_VIEW:                  "navigate-view",
  NAVIGATE_BACK:                  "navigate-back",
  RESIZE_PANEL:                   "resize-panel",
  OPEN_OPTIONS:                   "open-options",

  // Tab activation / preview
  ACTIVATE_TAB:                   "activate-tab",
  PREVIEW_TAB:                    "preview-tab",
  CLEAR_PREVIEW:                  "clear-preview",
  CLOSE_TAB:                      "close-tab",

  // Tab queries
  GET_ALL_TABS:                   "get-all-tabs",
  GET_TAB_INFO:                   "get-tab-info",
  GET_ACTIVE_TAB_INFO:             "get-active-tab-info",
  GET_DEFAULT_CLOSE_TARGET:       "get-default-close-target",
  GET_NAVIGATION_HISTORY:         "get-navigation-history",
  GET_RECENTLY_CLOSED:            "get-recently-closed",
  GET_HISTORY_VISITS:             "get-history-visits",
  GET_SELECTED_TAB_DOM_IDS:       "get-selected-tab-dom-ids",
  GET_SELECTED_TAB_URLS:          "get-selected-tab-urls",
  GET_WORKSPACES_WITH_ICONS:      "get-workspaces-with-icons",

  // Tab navigation
  GO_TO_PREVIOUS_TAB:             "go-to-previous-tab",
  GO_TO_PARENT_TAB:               "go-to-parent-tab",
  GO_BACK_IN_TAB:                 "go-back-in-tab",
  GO_FORWARD_IN_TAB:              "go-forward-in-tab",
  GO_TO_NEXT_VERTICAL_TAB:        "go-to-next-vertical-tab",
  GO_TO_PREV_VERTICAL_TAB:        "go-to-prev-vertical-tab",

  // Tab manipulation
  MOVE_TAB_TO_START:              "move-tab-to-start",
  MOVE_TAB_TO_END:                "move-tab-to-end",
  SCROLL_TO_CURRENT_TAB:          "scroll-to-current-tab",
  UNLOAD_TAB:                     "unload-tab",
  TOGGLE_PIN_TAB:                 "toggle-pin-tab",
  COPY_URL_MARKDOWN:              "copy-url-markdown",
  RESTORE_LAST_CLOSED_TAB:        "restore-last-closed-tab",
  RESTORE_CLOSED_TAB:             "restore-closed-tab",
  RESTORE_CLOSED_TAB_KEEP_OPEN:   "restore-closed-tab-keep-open",
  NAVIGATE_TO_HISTORY_INDEX:      "navigate-to-history-index",

  // Close-and-select submenu
  CLOSE_AND_SELECT_DEFAULT:       "close-and-select-default",
  CLOSE_AND_SELECT_PREVIOUS:      "close-and-select-previous",
  CLOSE_AND_SELECT_PARENT:        "close-and-select-parent",
  CLOSE_AND_SELECT_NEXT_SIBLING:  "close-and-select-next-sibling",
  CLOSE_AND_SELECT_PREV_SIBLING:  "close-and-select-prev-sibling",
  CLOSE_AND_SELECT_NEXT_VERTICAL: "close-and-select-next-vertical",
  CLOSE_AND_SELECT_PREV_VERTICAL: "close-and-select-prev-vertical",
  CLOSE_AND_SELECT_UNVISITED_NEWEST: "close-and-select-unvisited-newest",
  CLOSE_AND_SELECT_UNVISITED_OLDEST: "close-and-select-unvisited-oldest",

  // Workspace navigation
  GO_TO_NEXT_WORKSPACE:           "go-to-next-workspace",
  GO_TO_PREV_WORKSPACE:           "go-to-prev-workspace",
  SWITCH_WORKSPACE:               "switch-workspace",
  MOVE_SELECTED_TABS_TO_WORKSPACE: "move-selected-tabs-to-workspace",

  // Split view
  SPLIT_NEW:                      "split-new",
  SPLIT_CLOSE:                    "split-close",
  SPLIT_HORIZONTAL:               "split-horizontal",
  SPLIT_VERTICAL:                 "split-vertical",

  // Sort actions (handled by runSortAction in background.js)
  SORT_TABS_RECENT_DESC:          "sort-tabs-recent-desc",
  SORT_TABS_RECENT_ASC:           "sort-tabs-recent-asc",
  SORT_TABS_DOMAIN_ALPHA:         "sort-tabs-domain-alpha",
  SORT_TABS_DOMAIN_POP:           "sort-tabs-domain-pop",
  SORT_TABS_AGE_ASC:              "sort-tabs-age-asc",
  SORT_TABS_AGE_DESC:             "sort-tabs-age-desc",
  SORT_TABS_INACTIVE_BOTTOM:      "sort-tabs-inactive-bottom",
  SORT_TABS_MOST_VISITED:         "sort-tabs-most-visited",
  SORT_TABS_GROUP_DUPS:           "sort-tabs-group-dups",

  // Page 2 actions — this-page operations
  RELOAD_TAB:                     "reload-tab",
  RELOAD_SKIP_CACHE:              "reload-skip-cache",
  DUPLICATE_TAB:                  "duplicate-tab",
  TOGGLE_READER_MODE:             "toggle-reader-mode",
  VIEW_PAGE_SOURCE:               "view-page-source",
  VIEW_PAGE_INFO:                 "view-page-info",
  TOGGLE_MUTE:                    "toggle-mute",
  RESET_PINNED_TAB:               "reset-pinned-tab",
  ADD_TO_ESSENTIALS:              "add-to-essentials",
  TAKE_SCREENSHOT:                "take-screenshot",
  TOGGLE_PIP:                     "toggle-pip",
  TOGGLE_FULLSCREEN:              "toggle-fullscreen",
  TOGGLE_DEVTOOLS:                "toggle-devtools",
  TOGGLE_BROWSER_TOOLBOX:         "toggle-browser-toolbox",
  OPEN_DOWNLOADS:                 "open-downloads",
  OPEN_ADDONS:                    "open-addons",
  OPEN_FIREFOX_VIEW:              "open-firefox-view",
  COPY_URL:                       "copy-url",
  UNVISITED_NEWEST:               "unvisited-newest",
  UNVISITED_OLDEST:               "unvisited-oldest",
  MOVE_TAB_TO_FOLDER:             "move-tab-to-folder",
  REOPEN_IN_CONTAINER:            "reopen-in-container",
  GET_FOLDERS:                    "get-folders",

  // Companion mods
  CHECK_COMPANION_MOD:            "check-companion-mod",
  INSTALL_COMPANION_MOD:          "install-companion-mod",
  REMOVE_COMPANION_MOD:           "remove-companion-mod",

  // Profiles
  GET_PROFILES:                   "get-profiles",
  LAUNCH_PROFILE:                 "launch-profile",

  // Foreign extension popup hosting
  LIST_EXTENSIONS:                "list-extensions",
  OPEN_EXTENSION_POPUP:           "open-extension-popup",
});

// Default values for browser.storage.local. Pass to storage.get() to read
// any subset; the keys used as `get`'s argument also act as the schema.
this.STORAGE_DEFAULTS = Object.freeze({
  autoCloseEnabled:   false,
  autoCloseThreshold: "48h",
  autoMoveEnabled:    false,
  autoMoveDelay:      3000,
  welcomed:           false,
  interceptExtensionPopups: true,
});

// Whitelist of view names accepted by the navigate-view message. Mirrors
// the keys of VIEW_SIZES in experiment/api.js, plus "split-view" which the
// popup handles but uses the default size.
this.VIEW_IDS = new Set([
  "actions",
  "child-tabs",
  "sibling-tabs",
  "parent-tabs",
  "navigation",
  "unvisited-tabs",
  "last-visited",
  "recently-closed",
  "duplicates",
  "tab-info",
  "domains",
  "domain-tabs",
  "tabs-by-age",
  "most-visited",
  "reorder-tabs",
  "split-view",
  "move-to-workspace",
  "close-and-select",
  "move-to-folder",
  "open-in-container",
  "extension-popup",
]);

// Node test shim — let lib/ tests import constants without a browser context.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MSG: this.MSG,
    STORAGE_DEFAULTS: this.STORAGE_DEFAULTS,
    VIEW_IDS: this.VIEW_IDS,
  };
}
