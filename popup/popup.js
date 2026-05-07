"use strict";

// ---------------------------------------------------------------------------
// DOM refs and state
//
// Mutable state lives in popup/state.js (the `ui`, `tabState`, `wsState`
// objects). Const DOM refs stay here since they bind to elements found in
// popup.html which is owned by this script.
// ---------------------------------------------------------------------------

const listEl = document.getElementById("list");
const headerEl = document.getElementById("header");
const backButton = document.getElementById("back-button");
const viewTitle = document.getElementById("view-title");
const headerHint = document.getElementById("header-hint");
const sidebarEl = document.getElementById("sidebar");

const ext = typeof browser !== "undefined" ? browser : chrome;

// ---------------------------------------------------------------------------
// Delegated listeners on listEl
//
// One set of click / mouseover / mouseout / error listeners covers every
// tab row rendered by createTabElement (popup/render.js). Bespoke renderers
// in views/info.js (info-duplicate-row) and views/age.js (age-tab-item)
// have their own custom click + close-button handling — the delegate skips
// rows tagged with those classes so we don't double-fire.
//
// The error capture listener replaces what was previously a per-row
// img.addEventListener("error", ...) — error events don't bubble but they
// fire in capture phase, so a single listener at listEl handles every
// broken favicon in any sub-view.
// ---------------------------------------------------------------------------

const DELEGATE_SKIP_CLASSES = ["info-duplicate-row", "age-tab-item"];

function isDelegateSkipped(row) {
  for (const cls of DELEGATE_SKIP_CLASSES) {
    if (row.classList.contains(cls)) return true;
  }
  return false;
}

listEl.addEventListener("click", (e) => {
  const row = e.target.closest("[data-dom-id]");
  if (!row || row.classList.contains("disabled") || isDelegateSkipped(row)) return;
  if (e.target.classList.contains("item-close")) {
    e.stopPropagation();
    closeRowAndReindex(row);
    return;
  }
  activateTab(row.dataset.domId);
});

listEl.addEventListener("mouseover", (e) => {
  const row = e.target.closest("[data-dom-id]");
  if (!row || isDelegateSkipped(row)) return;
  // Suppress when the mouse merely entered a child element of the same row.
  const fromRow = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-dom-id]");
  if (fromRow === row) return;
  ext.runtime.sendMessage({ type: "preview-tab", domId: row.dataset.domId }).catch(() => {});
});

listEl.addEventListener("mouseout", (e) => {
  const row = e.target.closest("[data-dom-id]");
  if (!row || isDelegateSkipped(row)) return;
  // Don't clear when moving within the same row, or directly to a sibling
  // row whose mouseover will overwrite the preview anyway.
  const toRow = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-dom-id]");
  if (toRow === row || (toRow && !isDelegateSkipped(toRow))) return;
  ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
});

// Image-error events don't bubble — capture phase to catch failed favicons.
listEl.addEventListener("error", (e) => {
  const t = e.target;
  if (t && t.tagName === "IMG" && t.classList.contains("item-icon")) {
    t.style.display = "none";
  }
}, true);

// Fire-and-forget — don't await since the overlay destruction kills our context
function closePalette() {
  ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  ext.runtime.sendMessage({ type: "hide-palette" }).catch(() => {});
}

function activateTab(domId) {
  // activate-tab handler in background.js closes the palette and switches
  ext.runtime.sendMessage({ type: "activate-tab", domId }).catch(() => {});
}

// Close the tab represented by `row`, remove the row, re-number the
// remaining 1-9 badges, and adjust selection / empty state. Used by the
// X-button click delegate and by the W key shortcut. The menu stays open
// so the user can chain closes.
function closeRowAndReindex(row) {
  const domId = row.dataset.domId;
  if (!domId) return;
  ext.runtime.sendMessage({ type: "close-tab", domId }).catch(() => {});

  const idx = ui.items.findIndex((t) => t && t.domId === domId);
  if (idx >= 0) ui.items.splice(idx, 1);

  // If the row lived inside a .split-pair and removing it leaves a single
  // sibling, drop the now-orphaned pair separator so the layout doesn't
  // dangle. The .split-row container itself stays — the survivor renders
  // fine as a 1-tab pair.
  const pair = row.closest(".split-pair");
  row.remove();
  if (pair) {
    const remaining = pair.querySelectorAll(".list-item[data-dom-id]");
    if (remaining.length <= 1) {
      pair.querySelectorAll(".split-pair-indicator").forEach((s) => s.remove());
    }
    if (remaining.length === 0) {
      pair.closest(".split-row")?.remove();
    }
  }

  reassignBadges();

  if (ui.items.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    ui.selectedIndex = -1;
    updateSelection();
  } else {
    if (ui.selectedIndex >= ui.items.length) {
      ui.selectedIndex = ui.items.length - 1;
    }
    updateSelection();
  }

  invalidateAllTabsCache();
}

// Walk listEl in DOM order and renumber 1-9 badges across .split-row and
// top-level .list-item rows. Rows nested inside a .split-pair are skipped
// (their slot is owned by the parent .split-row). Rows past slot 9 lose
// their badge in favor of the placeholder element used by createTabElement.
function reassignBadges() {
  let slot = 1;
  const candidates = listEl.querySelectorAll(".split-row, .list-item[data-dom-id]");
  for (const row of candidates) {
    const isSplit = row.classList.contains("split-row");
    if (!isSplit && row.closest(".split-pair")) continue;

    if (isSplit) {
      let badgeWrap = row.querySelector(".split-row-badge");
      if (slot <= 9) {
        if (!badgeWrap) {
          badgeWrap = document.createElement("span");
          badgeWrap.className = "split-row-badge";
          row.appendChild(badgeWrap);
        }
        badgeWrap.innerHTML = renderBadge(String(slot));
      } else if (badgeWrap) {
        badgeWrap.remove();
      }
    } else {
      const stack = row.querySelector(".item-badge-stack");
      if (!stack) { slot++; continue; }
      const oldBadge = stack.querySelector(".item-badge");
      const oldPlaceholder = stack.querySelector(".item-badge-placeholder");
      if (slot <= 9) {
        if (oldBadge) {
          oldBadge.textContent = String(slot);
          oldBadge.classList.remove("badge-wide");
        } else if (oldPlaceholder) {
          oldPlaceholder.outerHTML = renderBadge(String(slot));
        } else {
          stack.insertAdjacentHTML("afterbegin", renderBadge(String(slot)));
        }
      } else if (oldBadge) {
        oldBadge.outerHTML = `<span class="item-badge-placeholder"></span>`;
      }
    }
    slot++;
  }
}

function closeSelectedRow() {
  if (ui.selectedIndex < 0 || ui.items.length === 0) return;
  const listItems = listEl.querySelectorAll(".list-item");
  const row = listItems[ui.selectedIndex];
  if (row && row.dataset.domId) closeRowAndReindex(row);
}

// ---------------------------------------------------------------------------
// Keybindings registry (loaded by popup.html before this script)
// ---------------------------------------------------------------------------

const KEYBINDINGS = window.ZEN_KEYBINDINGS || [];
const displayKey = window.zenDisplayKey || ((s) => s);

function kbById(id) {
  for (const e of KEYBINDINGS) {
    if (e.id === id) return e;
    if (e.children) {
      for (const c of e.children) if (c.id === id) return c;
    }
  }
  return null;
}

function kbChildrenOf(prefixId) {
  const parent = KEYBINDINGS.find((e) => e.id === prefixId);
  return parent?.children || [];
}

// Compute the canonical chord string for a keydown event ("Shift+T", "T", ",")
// matching the format stored in the registry.
function chordFromEvent(e) {
  if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
    return (e.shiftKey ? "Shift+" : "") + e.key.toUpperCase();
  }
  return e.key;
}

// ---------------------------------------------------------------------------
// Actions menu helpers
// ---------------------------------------------------------------------------

// Build a popup menu item from a registry entry, merging runtime-computed
// fields (preview, count). Layout flags (compact, etc.) are added by callers.
// Used by getActions() in views/actions.js.
function actionFromRegistry(id, extra) {
  const entry = kbById(id);
  if (!entry) return null;
  const base = {
    id: entry.id,
    label: entry.label,
    icon: entry.icon,
    hotkey: entry.chord,
    isView: entry.kind === "open-view" || entry.kind === "prefix",
  };
  for (const flag of ["needsParent", "needsChildren", "needsSiblings", "needsParentTabs", "needsUnvisited", "needsDuplicates", "needsRecentlyClosed", "needsHistory"]) {
    if (entry[flag]) base[flag] = true;
  }
  return Object.assign(base, extra);
}

// ---------------------------------------------------------------------------
// Icon rendering — SVG icons for consistent sizing
// ---------------------------------------------------------------------------

const SVG_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const SVG_ICONS = {
  "arrow-left-right": `<svg ${SVG_ATTRS}><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>`,
  "move-up": `<svg ${SVG_ATTRS}><path d="M8 6l4-4 4 4"/><path d="M12 2v14"/><circle cx="12" cy="20" r="2"/></svg>`,
  "move-down": `<svg ${SVG_ATTRS}><path d="M8 18l4 4 4-4"/><path d="M12 22V8"/><circle cx="12" cy="4" r="2"/></svg>`,
  "parent-node": `<svg ${SVG_ATTRS}><circle cx="12" cy="4" r="3"/><path d="M12 7v5"/><path d="M12 12l-5 5"/><path d="M12 12l5 5"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/></svg>`,
  "history": `<svg ${SVG_ATTRS}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`,
  "git-branch": `<svg ${SVG_ATTRS}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>`,
  "circle-dot": `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`,
  "clock": `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  "rotate-ccw": `<svg ${SVG_ATTRS}><path d="M3 12a9 9 0 1 0 3-7.7L3 7"/><path d="M3 3v4h4"/></svg>`,
  "copy": `<svg ${SVG_ATTRS}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
  "info": `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  "globe": `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
  "calendar-clock": `<svg ${SVG_ATTRS}><path d="M21 7.5V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><circle cx="18" cy="18" r="4"/><path d="M18 16.5v1.5l.7.7"/></svg>`,
  "star": `<svg ${SVG_ATTRS}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  "arrow-up-to-line": `<svg ${SVG_ATTRS}><path d="M5 3h14"/><path d="m12 7 5 5"/><path d="m12 7-5 5"/><path d="M12 7v14"/></svg>`,
  "arrow-down-to-line": `<svg ${SVG_ATTRS}><path d="M5 21h14"/><path d="m12 17 5-5"/><path d="m12 17-5-5"/><path d="M12 3v14"/></svg>`,
  "arrow-up-down": `<svg ${SVG_ATTRS}><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>`,
  "arrow-right-to-line": `<svg ${SVG_ATTRS}><path d="M17 12H3"/><path d="m11 18 6-6-6-6"/><path d="M21 5v14"/></svg>`,
  "locate": `<svg ${SVG_ATTRS}><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`,
  "moon": `<svg ${SVG_ATTRS}><path d="M12 3a6 6 0 009 9 9 9 0 11-9-9z"/></svg>`,
  "x-circle": `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  "arrow-down": `<svg ${SVG_ATTRS}><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
  "arrow-up": `<svg ${SVG_ATTRS}><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  "arrow-left": `<svg ${SVG_ATTRS}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  "arrow-right": `<svg ${SVG_ATTRS}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  "pin": `<svg ${SVG_ATTRS}><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/></svg>`,
  "link": `<svg ${SVG_ATTRS}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  "columns": `<svg ${SVG_ATTRS}><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7zM3 3h7v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>`,
  "rows": `<svg ${SVG_ATTRS}><path d="M3 12h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7H3z"/></svg>`,
  "plus": `<svg ${SVG_ATTRS}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  "gear": `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
};

function getIcon(icon) {
  if (!icon) return "";
  if (icon.startsWith("svg:")) return SVG_ICONS[icon.slice(4)] || "";
  return icon;
}

// ---------------------------------------------------------------------------
// Selection / sidebar / refresh — cross-view UI helpers used by the keyboard
// dispatcher and every show* view.
//
// Note: renderBadge, updateHeader, createTabElement, renderTabList are in
// popup/render.js. View-specific code is in popup/views/*.js.
// ---------------------------------------------------------------------------

function updateSelection() {
  const listItems = listEl.querySelectorAll(".list-item");
  listItems.forEach((el, i) => {
    el.classList.toggle("selected", i === ui.selectedIndex);
  });

  if (ui.selectedIndex >= 0) {
    const selected = listItems[ui.selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  if (ui.selectedIndex >= 0) {
    const item = ui.items[ui.selectedIndex];
    const isTabView = ui.currentView !== "actions" && ui.currentView !== "move-to-workspace" && ui.currentView !== "close-and-select" && ui.currentView !== "reorder-tabs";
    if (isTabView && item?.domId) {
      ext.runtime.sendMessage({ type: "preview-tab", domId: item.domId }).catch(() => {});
    } else if ((ui.currentView === "actions" || ui.currentView === "close-and-select") && item?.preview?.domId) {
      ext.runtime.sendMessage({ type: "preview-tab", domId: item.preview.domId }).catch(() => {});
    } else if (ui.currentView === "actions" || ui.currentView === "close-and-select") {
      ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
    }
  } else if (ui.currentView === "actions" || ui.currentView === "close-and-select") {
    ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  }

  // Sidebar "w" close hint is only meaningful with an active selection.
  const closeHint = sidebarEl.querySelector(".sidebar-close-hint");
  if (closeHint) closeHint.classList.toggle("hidden", ui.selectedIndex < 0);
}

function filterByWorkspace(tabs) {
  if (wsState.workspaceFilter === "all") return tabs;
  return tabs.filter((t) => t.workspaceId === wsState.workspaceFilter);
}

function renderSidebar(sortOptions) {
  sidebarEl.innerHTML = "";

  if (CLOSEABLE_VIEWS.has(ui.currentView)) {
    const hint = document.createElement("div");
    hint.className = "sidebar-close-hint hidden";
    hint.innerHTML = `<span class="sidebar-ws-name">Close tab</span> ${renderBadge("W")}`;
    hint.addEventListener("click", closeSelectedRow);
    sidebarEl.appendChild(hint);
  }

  if (sortOptions) {
    for (const opt of sortOptions) {
      const el = document.createElement("div");
      el.className = "sidebar-sort";
      el.innerHTML = `<span class="sidebar-ws-name">${escapeHtml(opt.label)}</span> ${renderBadge(opt.key)}`;
      el.addEventListener("click", opt.onClick);
      sidebarEl.appendChild(el);
    }
    const sep = document.createElement("div");
    sep.className = "sidebar-sep";
    sidebarEl.appendChild(sep);
  }

  const allEl = document.createElement("div");
  allEl.className = "sidebar-item" + (wsState.workspaceFilter === "all" ? " active" : "");
  allEl.innerHTML = `<span class="sidebar-ws-name">All</span> ${renderBadge("0")}`;
  allEl.addEventListener("click", () => {
    wsState.workspaceFilter = wsState.workspaceFilter === "all" ? wsState.activeWorkspaceId : "all";
    refreshCurrentView();
  });
  sidebarEl.appendChild(allEl);

  const allWorkspaces = Object.entries(wsState.workspaceMap);
  for (let i = 0; i < allWorkspaces.length; i++) {
    const [uuid, ws] = allWorkspaces[i];
    const badge = i < 9 ? "⇧" + (i + 1) : null;
    const isActive = wsState.workspaceFilter === uuid;

    const el = document.createElement("div");
    el.className = "sidebar-item" + (isActive ? " active" : "");

    const iconHtml = ws.svgContent
      ? `<span class="sidebar-ws-icon">${ws.svgContent}</span>`
      : "";
    el.innerHTML = `${iconHtml}<span class="sidebar-ws-name">${escapeHtml(ws.name)}</span>${renderBadge(badge)}`;

    el.addEventListener("click", () => {
      wsState.workspaceFilter = wsState.workspaceFilter === uuid ? "all" : uuid;
      refreshCurrentView();
    });

    sidebarEl.appendChild(el);
  }

  sidebarEl.classList.remove("hidden");
}

function hideSidebar() {
  sidebarEl.classList.add("hidden");
  sidebarEl.innerHTML = "";
  ui.sidebarFocused = false;
  ui.sidebarSelectedIndex = -1;
}

// View ids whose render is idempotent and cheap enough to re-run when
// the user toggles a sort or filter that affects them. Static views like
// the actions menu, info panes, and quick-menus are excluded.
const REFRESHABLE_VIEWS = new Set([
  "child-tabs", "sibling-tabs", "parent-tabs", "unvisited-tabs",
  "last-visited", "recently-closed", "duplicates",
  "domains", "domain-tabs", "tabs-by-age", "most-visited",
]);

// View ids where rows represent a live tab that can be closed in place via
// the X button (mouse) or W key (selection). Excludes:
//  - actions/info/navigation: not a tab list at all
//  - duplicates: has its own .dup-close handler (kept as the model)
//  - domains: rows are domain aggregates, not individual tabs
//  - recently-closed: rows are already-closed sessions
const CLOSEABLE_VIEWS = new Set([
  "child-tabs", "sibling-tabs", "parent-tabs", "unvisited",
  "last-visited", "domain-tabs", "most-visited", "tabs-by-age",
]);

function refreshCurrentView() {
  ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  if (!REFRESHABLE_VIEWS.has(ui.currentView)) return;
  const handler = VIEWS[ui.currentView];
  if (handler) handler();
}


// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function moveSelection(delta) {
  const count = ui.items.length;
  if (count === 0) return;

  if (ui.selectedIndex === -1) {
    ui.selectedIndex = delta > 0 ? 0 : count - 1;
  } else {
    ui.selectedIndex = (ui.selectedIndex + delta + count) % count;
  }

  // Skip disabled ui.items
  const startIndex = ui.selectedIndex;
  const listItems = listEl.querySelectorAll(".list-item");
  while (listItems[ui.selectedIndex]?.classList.contains("disabled")) {
    ui.selectedIndex = (ui.selectedIndex + delta + count) % count;
    if (ui.selectedIndex === startIndex) break;
  }

  updateSelection();
}

function jumpToSection(delta) {
  const count = ui.items.length;
  if (count === 0) return;
  const hasSidebar = !sidebarEl.classList.contains("hidden");

  // Single section (submenus): Tab between list and sidebar
  if (ui.sectionStarts.length <= 1) {
    if (hasSidebar) {
      if (!ui.sidebarFocused) {
        ui.sidebarFocused = true;
        ui.sidebarSelectedIndex = delta > 0 ? 0 : sidebarEl.querySelectorAll(".sidebar-item, .sidebar-sort").length - 1;
        ui.selectedIndex = -1;
        updateSelection();
        updateSidebarSelection();
        return;
      } else {
        ui.sidebarFocused = false;
        ui.sidebarSelectedIndex = -1;
        ui.selectedIndex = delta > 0 ? 0 : count - 1;
        updateSidebarSelection();
        updateSelection();
        return;
      }
    }
    ui.selectedIndex = delta > 0 ? 0 : count - 1;
    updateSelection();
    return;
  }

  // Find which section current selection is in
  let currentSection = 0;
  for (let i = ui.sectionStarts.length - 1; i >= 0; i--) {
    if (ui.selectedIndex >= ui.sectionStarts[i]) {
      currentSection = i;
      break;
    }
  }

  // Move to next/previous section
  let targetSection = currentSection + delta;
  if (targetSection < 0) targetSection = ui.sectionStarts.length - 1;
  if (targetSection >= ui.sectionStarts.length) targetSection = 0;

  ui.selectedIndex = ui.sectionStarts[targetSection];

  // Skip disabled ui.items forward
  const listItems = listEl.querySelectorAll(".list-item");
  const startIndex = ui.selectedIndex;
  while (listItems[ui.selectedIndex]?.classList.contains("disabled")) {
    ui.selectedIndex = (ui.selectedIndex + 1) % count;
    if (ui.selectedIndex === startIndex) break;
  }

  updateSelection();
}

function updateSidebarSelection() {
  const sidebarItems = sidebarEl.querySelectorAll(".sidebar-item, .sidebar-sort");
  sidebarItems.forEach((el, i) => {
    el.classList.toggle("focused", ui.sidebarFocused && i === ui.sidebarSelectedIndex);
  });
}

function moveSidebarSelection(delta) {
  const sidebarItems = sidebarEl.querySelectorAll(".sidebar-item, .sidebar-sort");
  const count = sidebarItems.length;
  if (count === 0) return;
  if (ui.sidebarSelectedIndex === -1) {
    ui.sidebarSelectedIndex = delta > 0 ? 0 : count - 1;
  } else {
    ui.sidebarSelectedIndex = (ui.sidebarSelectedIndex + delta + count) % count;
  }
  updateSidebarSelection();
}

function activateSidebarSelected() {
  const sidebarItems = sidebarEl.querySelectorAll(".sidebar-item, .sidebar-sort");
  if (ui.sidebarSelectedIndex >= 0 && ui.sidebarSelectedIndex < sidebarItems.length) {
    sidebarItems[ui.sidebarSelectedIndex].click();
  }
}

function activateSelected() {
  if (ui.selectedIndex < 0 || ui.items.length === 0) return;

  const item = ui.items[ui.selectedIndex];
  const listItems = listEl.querySelectorAll(".list-item");
  if (listItems[ui.selectedIndex]?.classList.contains("disabled")) return;

  if (item.navIndex !== undefined && !item.isCurrent) {
    ext.runtime.sendMessage({ type: "navigate-to-history-index", index: item.navIndex }).catch(() => {});
  } else if (item.id && typeof item.hotkey !== "undefined") {
    activateAction(item);
  } else if (item.reorderAction) {
    ext.runtime.sendMessage({ type: item.reorderAction }).catch(() => {});
  } else if (item.domain) {
    navigateToView("domain-tabs", { domain: item.domain });
  } else if (item.uuid) {
    moveToWorkspace(item.uuid);
  } else if (item.sessionId) {
    ext.runtime.sendMessage({ type: "restore-closed-tab", sessionId: item.sessionId }).catch(() => {});
  } else if (item.domId) {
    activateTab(item.domId);
  }
}

function navigateToView(view, params) {
  ext.runtime.sendMessage({ type: "navigate-view", view, params: params ? JSON.stringify(params) : undefined }).catch(() => {});
}

function navigateBack() {
  ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  ext.runtime.sendMessage({ type: "navigate-back" }).catch(() => {});
}

function activateAction(action) {
  const entry = kbById(action.id);
  if (!entry) return;
  if (entry.kind === "action") {
    ext.runtime.sendMessage({ type: action.id }).catch(() => {});
  } else if (entry.kind === "open-view" || entry.kind === "prefix") {
    navigateToView(entry.view);
  }
}

// ---------------------------------------------------------------------------
// Views — see popup/views/*.js for the show* functions.
// ---------------------------------------------------------------------------

function goBack() {
  if (ui.currentView !== "actions") {
    navigateBack();
  }
}

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

// Keydown handling lives in popup/keyboard.js.

backButton.addEventListener("click", goBack);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// `escapeHtml`, `escapeAttr`, `extractFavicon`, `extractDomain` come from
// shared/dom-utils.js. `renderBadge`, `updateHeader`, `createTabElement`,
// `renderTabList` live in popup/render.js. All of these are loaded via
// <script> tags in popup.html before this file.

// ---------------------------------------------------------------------------
// Theme — sync with Zen's dark/light mode
// ---------------------------------------------------------------------------

const urlParams = new URLSearchParams(window.location.search);
const theme = urlParams.get("theme") || "dark";
document.documentElement.style.colorScheme = theme;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const initialView = urlParams.get("view");
const paramDomain = urlParams.get("domain");
const paramWorkspace = urlParams.get("workspace");

async function init() {
  if (paramWorkspace) wsState.workspaceFilter = paramWorkspace;
  if (paramDomain) tabState.currentDomain = paramDomain;

  if (!initialView) {
    await showActionsMenu();
    return;
  }

  await fetchWorkspaceMap();
  const handler = VIEWS[initialView];
  if (handler) await handler({ domain: paramDomain });
}

init();