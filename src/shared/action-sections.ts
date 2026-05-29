// Source of truth for the root actions menu section layout.
//
// Chrome owns counts, availability, previews, workspace rows, and action
// resolution. This file only describes which navigation ids belong to each
// visual section/page so the popup and chrome model do not maintain parallel
// hard-coded layouts.

export const ACTION_SECTIONS = [
  { id: "navigate", label: "Navigate", page: 1, navigateGrid: true, actionIds: ["go-to-previous-tab", "go-to-parent-tab", "go-to-prev-vertical-tab", "go-to-next-vertical-tab"] },
  { id: "this-tab", label: "This tab", page: 1, column: true, actionIds: ["tab-info", "navigation", "child-tabs", "sibling-tabs"] },
  { id: "tab-actions", label: "Tab actions", page: 1, column: true, stack: true, actionIds: ["restore-last-closed-tab", "unload-tab", "close-and-select"] },
  { id: "all-tabs", label: "All tabs", page: 1, column: true, actionIds: ["parent-tabs", "unvisited-tabs", "last-visited", "recently-closed", "duplicates", "domains", "tabs-by-age", "most-visited"] },
  { id: "organize", label: "Organize", page: 1, column: true, actionIds: ["toggle-pin-tab", "move-tab-to-start", "move-tab-to-end", "reorder-tabs", "move-to-workspace", "move-to-folder", "scroll-to-current-tab", "split-view"] },
  { id: "workspaces", label: "Workspaces", page: 1, column: true, scrollable: true, actionIds: ["go-to-prev-workspace", "go-to-next-workspace"] },
  { id: "navigate", label: "Navigate", page: 2, navigateGrid: true, actionIds: ["go-back-in-tab", "go-forward-in-tab", "unvisited-newest", "unvisited-oldest"] },
  { id: "this-page", label: "This page", page: 2, column: true, actionIds: ["reload-tab", "reload-skip-cache", "duplicate-tab", "toggle-reader-mode", "toggle-mute", "toggle-fullscreen", "toggle-pip"] },
  { id: "tab", label: "Tab", page: 2, column: true, actionIds: ["mark-tabs-new", "reset-pinned-tab", "replace-pinned-url", "add-to-essentials", "open-in-container"] },
  { id: "profiles", label: "Profiles", page: 2, column: true, stack: true, actionIds: ["profiles", "workspace-actions"] },
  { id: "developer", label: "Developer", page: 2, column: true, actionIds: ["toggle-devtools", "toggle-browser-toolbox"] },
  { id: "browser", label: "Browser", page: 2, column: true, stack: true, actionIds: ["open-downloads", "open-addons", "open-firefox-view"] },
  { id: "page-tools", label: "Page tools", page: 2, column: true, actionIds: ["view-page-source", "view-page-info", "take-screenshot", "copy-url", "copy-url-markdown"] },
  { id: "other", label: "Other", page: 2, column: true, stack: true, actionIds: ["command-palette", "replay-last-chord", "open-options"] },
] as const;
