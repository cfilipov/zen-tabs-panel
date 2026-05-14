// Source of truth for chord and menu key bindings.
//
// Build output:
//   scripts/generate-keybindings.mjs emits dist/shared/keybindings.js for
//   experiment/api.js and the current compatibility popup runtime.
//
// Hotkey notation:
//   "P"        bare key
//   "Shift+T"  shifted form — the chord engine matches this exact form
//              (popup converts to "⇧T" only at display time)
//   ","        literal punctuation
//
// Entry kinds:
//   action     — fires the id as an actionId (chord) / dispatches in popup
//   open-view  — opens the named popup view immediately
//   prefix     — top-level only; consumes the next chord key, opens `view`
//                on timeout. Children are nested entries.
//
// Page assignment (`page`, optional, default 1):
//   The actions menu paginates horizontally. Top-level entries with `page: 2`
//   render on the second page (Space cycles pages). Chord lookup is global —
//   pressing a page-2 chord while page 1 is showing fires the action with no
//   page flip. Chord namespace is shared across pages, so collisions across
//   pages are not allowed.

import type { NavNode } from "./types";

export const NAVIGATION_TREE = [
  // Tab navigation
  { id: "go-to-previous-tab", kind: "action", chord: "P", label: "Previous", icon: "svg:arrow-left-right" },
  { id: "go-to-parent-tab",   kind: "action", chord: "T", label: "Parent",   icon: "svg:move-up", needsParent: true },
  { id: "go-back-in-tab",          kind: "action", chord: "[", label: "Back",     icon: "svg:arrow-left", page: 2 },
  { id: "go-forward-in-tab",       kind: "action", chord: "]", label: "Forward",  icon: "svg:arrow-right", page: 2 },
  { id: "go-to-prev-vertical-tab", kind: "action", chord: "J", label: "Above",    icon: "svg:arrow-up" },
  { id: "go-to-next-vertical-tab", kind: "action", chord: "K", label: "Below",    icon: "svg:arrow-down" },

  // Browse views
  { id: "child-tabs",      kind: "open-view", chord: "C",       view: "child-tabs",      label: "Children",        icon: "svg:move-down",     needsChildren: true },
  { id: "sibling-tabs",    kind: "open-view", chord: "B",       view: "sibling-tabs",    label: "Siblings",        icon: "svg:git-branch",    needsSiblings: true },
  { id: "parent-tabs",     kind: "open-view", chord: "Shift+T", view: "parent-tabs",     label: "Parent tabs",     icon: "svg:parent-node",   needsParentTabs: true },
  { id: "navigation",      kind: "open-view", chord: "H",       view: "navigation",      label: "Tab history",     icon: "svg:history",       needsHistory: true },
  { id: "unvisited-tabs",  kind: "open-view", chord: "N",       view: "unvisited-tabs",  label: "New tabs",        icon: "svg:circle-dot",    needsUnvisited: true },
  { id: "last-visited",    kind: "open-view", chord: "R",       view: "last-visited",    label: "Recent",          icon: "svg:clock" },
  { id: "recently-closed", kind: "open-view", chord: "X",       view: "recently-closed", label: "Recently closed", icon: "svg:rotate-ccw",    needsRecentlyClosed: true },
  { id: "duplicates",      kind: "open-view", chord: "D",       view: "duplicates",      label: "Duplicates",      icon: "svg:copy",          needsDuplicates: true },
  { id: "tab-info",        kind: "open-view", chord: "I",       view: "tab-info",        label: "Tab info",        icon: "svg:info" },
  { id: "domains",         kind: "open-view", chord: "Q",       view: "domains",         label: "Domains",         icon: "svg:globe" },
  { id: "tabs-by-age",     kind: "open-view", chord: "A",       view: "tabs-by-age",     label: "Tabs by age",     icon: "svg:calendar-clock" },
  { id: "most-visited",    kind: "open-view", chord: "V",       view: "most-visited",    label: "Most visited",    icon: "svg:star" },

  // Tab actions
  { id: "move-tab-to-start",     kind: "action",    chord: "S", label: "Move to start",      icon: "svg:arrow-up-to-line" },
  { id: "move-tab-to-end",       kind: "action",    chord: "E", label: "Move to end",        icon: "svg:arrow-down-to-line" },
  { id: "move-to-workspace",     kind: "open-view", chord: "M", view: "move-to-workspace",   label: "Move to workspace", icon: "svg:arrow-right-to-line" },
  { id: "scroll-to-current-tab", kind: "action",    chord: "L", label: "Scroll to tab",      icon: "svg:locate" },
  { id: "unload-tab",            kind: "action",    chord: "U", label: "Unload",             icon: "svg:moon" },
  { id: "open-options",          kind: "action",    chord: ",", label: "Settings",           icon: "svg:gear" },

  // Workspace navigation
  { id: "go-to-next-workspace", kind: "action", chord: "}", label: "Next workspace",     icon: "svg:arrow-right" },
  { id: "go-to-prev-workspace", kind: "action", chord: "{", label: "Previous workspace", icon: "svg:arrow-left" },

  // Quick tab tools
  { id: "toggle-pin-tab",          kind: "action", chord: "F", label: "Pin/unpin tab",      icon: "svg:pin" },
  { id: "copy-url-markdown",       kind: "action", chord: "Y", label: "Copy URL as MD", icon: "svg:link", page: 2 },
  { id: "restore-last-closed-tab", kind: "action", chord: "Z", label: "Restore closed tab", icon: "svg:rotate-ccw" },

  // Page 2 — This page
  { id: "reload-tab",         kind: "action", chord: "Shift+R", label: "Reload",            icon: "svg:rotate-ccw",       page: 2 },
  { id: "reload-skip-cache",  kind: "action", chord: "Shift+L", label: "Hard reload",       icon: "svg:rotate-ccw",       page: 2 },
  { id: "duplicate-tab",      kind: "action", chord: "Shift+D", label: "Duplicate",         icon: "svg:copy",             page: 2 },
  { id: "toggle-reader-mode", kind: "action", chord: "Shift+M", label: "Reader mode",       icon: "svg:book-open",        page: 2 },
  { id: "view-page-source",   kind: "action", chord: "Shift+U", label: "View source",       icon: "svg:code",             page: 2 },
  { id: "view-page-info",     kind: "action", chord: "Shift+I", label: "Page info",         icon: "svg:info",             page: 2 },
  { id: "toggle-mute",        kind: "action", chord: "Shift+V", label: "Mute/unmute",       icon: "svg:volume-x",         page: 2 },
  { id: "reset-pinned-tab",   kind: "action", chord: "Shift+P", label: "Reset pinned url",  icon: "svg:pin",              page: 2, needsPinnedTab: true },
  { id: "add-to-essentials",  kind: "action", chord: "Shift+E", label: "Add to essentials", icon: "svg:star",             page: 2 },
  { id: "take-screenshot",    kind: "action", chord: "Shift+S", label: "Screenshot",        icon: "svg:camera",           page: 2 },
  { id: "toggle-pip",         kind: "action", chord: ";",       label: "Picture-in-picture", icon: "svg:picture-in-picture", page: 2 },
  { id: "toggle-fullscreen",  kind: "action", chord: "Shift+F", label: "Full screen",       icon: "svg:maximize",         page: 2 },

  // Page 2 — Tab actions
  { id: "open-in-container",  kind: "open-view", chord: "Shift+N", view: "open-in-container", label: "New container tab", icon: "svg:layers", page: 2 },

  // Page 2 — All tabs
  { id: "unvisited-newest",   kind: "action", chord: "G",       label: "Newest unvisited", icon: "svg:circle-dot", page: 2, needsUnvisited: true },
  { id: "unvisited-oldest",   kind: "action", chord: "Shift+G", label: "Oldest unvisited", icon: "svg:circle-dot", page: 2, needsUnvisited: true },

  // Page 2 — Developer
  { id: "toggle-devtools",        kind: "action", chord: "Shift+J", label: "DevTools",        icon: "svg:terminal", page: 2 },
  { id: "toggle-browser-toolbox", kind: "action", chord: "Shift+B", label: "Browser toolbox", icon: "svg:wrench",   page: 2 },

  // Page 2 — Browser
  { id: "open-downloads",     kind: "action", chord: "Shift+W", label: "Downloads",     icon: "svg:download", page: 2 },
  { id: "open-addons",        kind: "action", chord: "Shift+A", label: "Add-ons",       icon: "svg:puzzle",   page: 2 },
  { id: "open-firefox-view",  kind: "action", chord: "Shift+H", label: "Firefox View",  icon: "svg:eye",      page: 2 },

  // Page 2 — Page tools (additions)
  { id: "copy-url",           kind: "action", chord: "Shift+Y", label: "Copy URL",      icon: "svg:copy",     page: 2 },

  // Profiles submenu — open a view that lists installed Zen profiles
  // for switching/launching. Previously inlined as a column on page 2;
  // moved to its own view so the actions menu stays compact.
  { id: "profiles",           kind: "open-view", chord: "'", view: "profiles", label: "Profiles", icon: "svg:user", page: 2 },

  // Page 2 — Repeat the most recent chord-action. Chord is "." after
  // the leader, so cmd+.,. fires whatever cmd+.,X you did last —
  // particularly handy for cycling close-and-select-next-vertical.
  { id: "replay-last-chord",  kind: "action", chord: ".",       label: "Repeat last",   icon: "svg:rotate-ccw", page: 2 },

  // Page 1 — Organize (new)
  { id: "move-to-folder",     kind: "open-view", chord: "Shift+O", view: "move-to-folder", label: "Move to folder", icon: "svg:folder" },

  // Split-view submenu
  {
    id: "split-view",
    kind: "prefix",
    chord: "\\",
    view: "split-view",
    label: "Split",
    icon: "svg:columns",
    children: [
      { id: "split-new",        kind: "action", chord: "N", label: "New split",   icon: "svg:plus" },
      { id: "split-close",      kind: "action", chord: "C", label: "Close split", icon: "svg:x-circle" },
      { id: "split-horizontal", kind: "action", chord: "H", label: "Horizontal",  icon: "svg:rows" },
      { id: "split-vertical",   kind: "action", chord: "V", label: "Vertical",    icon: "svg:columns" },
    ],
  },

  // Reorder submenu
  {
    id: "reorder-tabs",
    kind: "prefix",
    chord: "O",
    view: "reorder-tabs",
    label: "Reorder tabs",
    icon: "svg:arrow-up-down",
    children: [
      { id: "sort-tabs-recent-desc",     kind: "action", chord: "R",       label: "Recent (newest first)",  icon: "svg:clock" },
      { id: "sort-tabs-recent-asc",      kind: "action", chord: "Shift+R", label: "Recent (oldest first)",  icon: "svg:clock" },
      { id: "sort-tabs-domain-alpha",    kind: "action", chord: "D",       label: "Domain (A-Z)",           icon: "svg:globe" },
      { id: "sort-tabs-domain-pop",      kind: "action", chord: "Shift+D", label: "Domain (by popularity)", icon: "svg:globe" },
      { id: "sort-tabs-age-asc",         kind: "action", chord: "A",       label: "Age (oldest first)",     icon: "svg:calendar-clock" },
      { id: "sort-tabs-age-desc",        kind: "action", chord: "Shift+A", label: "Age (newest first)",     icon: "svg:calendar-clock" },
      { id: "sort-tabs-inactive-bottom", kind: "action", chord: "I",       label: "Inactive at bottom",     icon: "svg:moon" },
      { id: "sort-tabs-most-visited",    kind: "action", chord: "V",       label: "Most visited first",     icon: "svg:star" },
      { id: "sort-tabs-group-dups",      kind: "action", chord: "G",       label: "Group duplicates",       icon: "⊜" },
    ],
  },

  // Close & select submenu
  {
    id: "close-and-select",
    kind: "prefix",
    chord: "W",
    view: "close-and-select",
    label: "Close & select…",
    icon: "svg:x-circle",
    children: [
      { id: "close-and-select-default",       kind: "action", chord: "W",       label: "Default",             icon: "svg:x-circle" },
      { id: "close-and-select-previous",      kind: "action", chord: "P",       label: "Previous",            icon: "svg:arrow-left-right" },
      { id: "close-and-select-parent",        kind: "action", chord: "T",       label: "Parent",              icon: "svg:move-up" },
      { id: "close-and-select-next-sibling",  kind: "action", chord: "C",       label: "Next sibling",        icon: "svg:git-branch" },
      { id: "close-and-select-prev-sibling",  kind: "action", chord: "Shift+C", label: "Previous sibling",    icon: "svg:git-branch" },
      { id: "close-and-select-next-vertical",   kind: "action", chord: "N",       label: "Next in sidebar",     icon: "svg:arrow-down" },
      { id: "close-and-select-prev-vertical",   kind: "action", chord: "Shift+N", label: "Previous in sidebar", icon: "svg:arrow-up" },
      { id: "close-and-select-unvisited-newest", kind: "action", chord: "G",       label: "Newest unvisited",   icon: "svg:circle-dot" },
      { id: "close-and-select-unvisited-oldest", kind: "action", chord: "Shift+G", label: "Oldest unvisited",   icon: "svg:circle-dot" },
    ],
  },
] satisfies NavNode[];

// Workspace digit chords. Each digit selects the workspace at the given
// index. "0" selects the 10th workspace (matching keyboard layout where 0
// follows 9). The popup also handles 1-9 directly when the palette is open.
export const WORKSPACE_DIGIT_CHORDS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

// Display helper: "Shift+T" -> "⇧T" for the on-screen badge. Bare keys and
// punctuation pass through unchanged.
export function displayKey(chord: string | null | undefined): string {
  if (chord == null || chord === "") return "";
  return String(chord).replace(/^Shift\+/, "⇧");
};
