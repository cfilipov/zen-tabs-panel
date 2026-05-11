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
const pageIndicatorEl = document.getElementById("page-indicator");

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
  if (e.target.closest(".item-close")) {
    e.stopPropagation();
    closeRowAndReindex(row);
    return;
  }
  if (e.target.closest('[data-action="drill-children"]')) {
    e.stopPropagation();
    navigateToView("child-tabs", { parentDomId: row.dataset.domId });
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

// ---------------------------------------------------------------------------
// Actions menu paging — gestures
//
// Trackpad horizontal swipe surfaces as a wheel event with non-zero deltaX.
// Touch swipe lands as touchstart/touchmove/touchend. Both target #list and
// only act on the actions view. Each gesture is rate-limited so a single
// inertial flick doesn't multi-page.
// ---------------------------------------------------------------------------

const PAGE_SWIPE_PX = 60;          // touch threshold
const PAGE_WHEEL_PX = 50;          // wheel deltaX threshold
const PAGE_GESTURE_COOLDOWN = 350; // ms between consecutive page changes
let _lastPageGesture = 0;

function tryPageGesture(delta) {
  if (ui.currentView !== "actions") return;
  const now = Date.now();
  if (now - _lastPageGesture < PAGE_GESTURE_COOLDOWN) return;
  _lastPageGesture = now;
  cycleActionsPage(delta);
}

listEl.addEventListener("wheel", (e) => {
  if (ui.currentView !== "actions") return;
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical scroll wins
  if (Math.abs(e.deltaX) < PAGE_WHEEL_PX) return;
  e.preventDefault();
  tryPageGesture(e.deltaX > 0 ? 1 : -1);
}, { passive: false });

let _touchStartX = null;
let _touchStartY = null;
listEl.addEventListener("touchstart", (e) => {
  if (ui.currentView !== "actions") return;
  if (e.touches.length !== 1) { _touchStartX = null; return; }
  _touchStartX = e.touches[0].clientX;
  _touchStartY = e.touches[0].clientY;
}, { passive: true });

listEl.addEventListener("touchend", (e) => {
  if (ui.currentView !== "actions") return;
  if (_touchStartX == null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - _touchStartX;
  const dy = t.clientY - _touchStartY;
  _touchStartX = null;
  _touchStartY = null;
  if (Math.abs(dx) < PAGE_SWIPE_PX) return;
  if (Math.abs(dy) > Math.abs(dx)) return; // vertical drag wins
  tryPageGesture(dx < 0 ? 1 : -1);
}, { passive: true });

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

function drillIntoSelectedParent() {
  if (ui.selectedIndex < 0 || ui.items.length === 0) return;
  const parent = ui.items[ui.selectedIndex];
  if (!parent || !parent.domId) return;
  navigateToView("child-tabs", { parentDomId: parent.domId });
}

// Close every tab currently visible in the list (e.g. "Close all children"
// from the child-tabs view). Awaits each close so the subsequent refresh
// reads the post-close state, not stale cache.
async function closeAllRowsInView() {
  if (ui.items.length === 0) return;
  const domIds = ui.items.map((it) => it && it.domId).filter(Boolean);
  if (domIds.length === 0) return;
  await Promise.all(domIds.map((domId) =>
    ext.runtime.sendMessage({ type: "close-tab", domId }).catch(() => {})
  ));
  invalidateAllTabsCache();
  refreshCurrentView();
}

// Restore the closed-session row without dismissing the palette. Mirrors
// closeRowAndReindex: removes the row in place, renumbers the 1-9 badges,
// adjusts selection, and shows the empty state when the list runs out.
// Used by the ↺ icon click handler and by the O key shortcut.
function restoreRowAndReindex(row) {
  const sessionId = row.dataset.sessionId;
  if (!sessionId) return;
  ext.runtime.sendMessage({ type: "restore-closed-tab-keep-open", sessionId }).catch(() => {});

  const idx = ui.items.findIndex((t) => t && t.sessionId === sessionId);
  if (idx >= 0) ui.items.splice(idx, 1);

  row.remove();
  reassignBadges();

  if (ui.items.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No recently closed tabs</div>`;
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

function restoreSelectedRow() {
  if (ui.selectedIndex < 0 || ui.items.length === 0) return;
  const listItems = listEl.querySelectorAll(".list-item");
  const row = listItems[ui.selectedIndex];
  if (row && row.dataset.sessionId) restoreRowAndReindex(row);
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
// All `.list-item` rows in the popup are arrow-key-navigable. Workspace
// switcher rows used to be excluded here because they weren't in ui.items;
// renderWorkspaceSwitcher now pushes a synthetic ui.items entry per
// workspace so the index alignment holds and the filter is unnecessary.
function navigableListItems() {
  return listEl.querySelectorAll(".list-item");
}

function actionFromRegistry(id, extra) {
  const entry = kbById(id);
  if (!entry) return null;
  const base = {
    id: entry.id,
    label: entry.label,
    icon: entry.icon,
    hotkey: entry.chord,
    isView: entry.kind === "open-view" || entry.kind === "prefix",
    page: entry.page || 1,
  };
  for (const flag of ["needsParent", "needsChildren", "needsSiblings", "needsParentTabs", "needsUnvisited", "needsDuplicates", "needsRecentlyClosed", "needsHistory", "needsPinnedTab"]) {
    if (entry[flag]) base[flag] = true;
  }
  return Object.assign(base, extra);
}

// ---------------------------------------------------------------------------
// Actions menu paging — horizontal swipe between pages of the main menu.
// State (`ui.currentPage`, `ui.pageCount`, `ui.pageBounds`) is set by
// renderActions in views/actions.js. The pager is the .actions-pager element
// inside #list; translateX moves between pages.
// ---------------------------------------------------------------------------

function applyPagerTransform() {
  const pager = listEl.querySelector(".actions-pager");
  if (!pager) return;
  const offset = (ui.currentPage - 1) * 100;
  pager.style.transform = `translateX(-${offset}%)`;
}

// Set transform without firing the slide animation — used on first render
// so the popup doesn't visibly snap to page 1. The class is removed in the
// next frame so subsequent page changes animate normally.
function applyPagerTransformInstant() {
  const pager = listEl.querySelector(".actions-pager");
  if (!pager) return;
  pager.classList.add("no-anim");
  applyPagerTransform();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => pager.classList.remove("no-anim"));
  });
}

function renderPageIndicator() {
  if (!pageIndicatorEl) return;
  if (ui.currentView !== "actions" || ui.pageCount <= 1) {
    pageIndicatorEl.classList.add("hidden");
    pageIndicatorEl.innerHTML = "";
    return;
  }
  pageIndicatorEl.classList.remove("hidden");
  pageIndicatorEl.innerHTML = "";
  for (let i = 1; i <= ui.pageCount; i++) {
    const dot = document.createElement("span");
    dot.className = "page-dot" + (i === ui.currentPage ? " active" : "");
    dot.dataset.page = String(i);
    dot.addEventListener("click", () => setActionsPage(i));
    pageIndicatorEl.appendChild(dot);
  }
}

function setActionsPage(targetPage) {
  if (ui.currentView !== "actions") return;
  if (ui.pageCount <= 1) return;
  // Wrap in both directions.
  let p = targetPage;
  if (p < 1) p = ui.pageCount;
  if (p > ui.pageCount) p = 1;
  if (p === ui.currentPage) return;
  ui.currentPage = p;
  ui.selectedIndex = -1;
  applyPagerTransform();
  renderPageIndicator();
  updateSelection();
  ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
}

function cycleActionsPage(delta) {
  if (ui.pageCount <= 1) return;
  setActionsPage(ui.currentPage + delta);
}

// Compute the [start, end) range in ui.items that belongs to the current
// actions page. Used by moveSelection / jumpToSection to wrap within a page.
// Falls back to the full ui.items range outside the actions view.
function currentPageBounds() {
  if (ui.currentView !== "actions" || !Array.isArray(ui.pageBounds) || ui.pageBounds.length === 0) {
    return [0, ui.items.length];
  }
  const idx = ui.currentPage - 1;
  return ui.pageBounds[idx] || [0, ui.items.length];
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
  "book-open": `<svg ${SVG_ATTRS}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  "code": `<svg ${SVG_ATTRS}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  "volume-x": `<svg ${SVG_ATTRS}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
  "camera": `<svg ${SVG_ATTRS}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  "picture-in-picture": `<svg ${SVG_ATTRS}><path d="M21 9V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6"/><rect x="13" y="13" width="8" height="6" rx="1"/></svg>`,
  "maximize": `<svg ${SVG_ATTRS}><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,
  "layers": `<svg ${SVG_ATTRS}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  "terminal": `<svg ${SVG_ATTRS}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  "wrench": `<svg ${SVG_ATTRS}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  "download": `<svg ${SVG_ATTRS}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  "puzzle": `<svg ${SVG_ATTRS}><path d="M19 11h2a2 2 0 0 1 0 4h-2v4a2 2 0 0 1-2 2h-4v-2a2 2 0 0 0-4 0v2H5a2 2 0 0 1-2-2v-4h2a2 2 0 0 0 0-4H3V7a2 2 0 0 1 2-2h4V3a2 2 0 0 1 4 0v2h4a2 2 0 0 1 2 2z"/></svg>`,
  "folder": `<svg ${SVG_ATTRS}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  "eye": `<svg ${SVG_ATTRS}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  "user": `<svg ${SVG_ATTRS}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
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
  const listItems = navigableListItems();
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

  // Sidebar action hints are only meaningful with an active selection.
  // In hints-only views (recently-closed), the whole sidebar collapses
  // when nothing is selected so the empty rail doesn't reserve space.
  const noSelection = ui.selectedIndex < 0;
  const closeHint = sidebarEl.querySelector(".sidebar-close-hint");
  if (closeHint) closeHint.classList.toggle("hidden", noSelection);
  const restoreHint = sidebarEl.querySelector(".sidebar-restore-hint");
  if (restoreHint) restoreHint.classList.toggle("hidden", noSelection);
  const childrenHint = sidebarEl.querySelector(".sidebar-children-hint");
  if (childrenHint) childrenHint.classList.toggle("hidden", noSelection);

  // Drop the divider too when nothing above it is still visible — otherwise
  // selection-dependent hints leave behind a stray leading rule.
  const sep = sidebarEl.querySelector(".sidebar-sep");
  if (sep) {
    const anyVisibleHint = sidebarEl.querySelector(".sidebar-close-hint:not(.hidden), .sidebar-close-all-hint, .sidebar-restore-hint:not(.hidden), .sidebar-children-hint:not(.hidden)");
    sep.classList.toggle("hidden", !anyVisibleHint);
  }
  if (sidebarEl.classList.contains("sidebar-hints-only")) {
    sidebarEl.classList.toggle("hidden", noSelection);
  }
}

function filterByWorkspace(tabs) {
  if (wsState.workspaceFilter === "all") return tabs;
  return tabs.filter((t) => t.workspaceId === wsState.workspaceFilter);
}

function renderSidebar(sortOptions, opts) {
  sidebarEl.innerHTML = "";
  sidebarEl.classList.remove("sidebar-hints-only");

  // Track whether we emitted any action hints (Close, Show children, Restore).
  // Sort toggles don't count — they're filtering controls, like the workspace
  // list, so they group with the workspace section rather than separating
  // from it.
  let hasHintsAbove = false;

  if (CLOSEABLE_VIEWS.has(ui.currentView)) {
    const hint = document.createElement("div");
    hint.className = "sidebar-close-hint hidden";
    hint.innerHTML = `<span class="sidebar-ws-name">Close tab</span> ${renderBadge("W")}`;
    hint.addEventListener("click", closeSelectedRow);
    sidebarEl.appendChild(hint);
    hasHintsAbove = true;
  }

  if (CLOSE_ALL_VIEWS.has(ui.currentView)) {
    const hint = document.createElement("div");
    hint.className = "sidebar-close-all-hint";
    hint.innerHTML = `<span class="sidebar-ws-name">Close all</span> ${renderBadge("⇧W")}`;
    hint.addEventListener("click", closeAllRowsInView);
    sidebarEl.appendChild(hint);
    hasHintsAbove = true;
  }

  if (RESTOREABLE_VIEWS.has(ui.currentView)) {
    const hint = document.createElement("div");
    hint.className = "sidebar-restore-hint hidden";
    hint.innerHTML = `<span class="sidebar-ws-name">Restore tab</span> ${renderBadge("O")}`;
    hint.addEventListener("click", restoreSelectedRow);
    sidebarEl.appendChild(hint);
    hasHintsAbove = true;
  }

  if (DRILL_CHILDREN_VIEWS.has(ui.currentView)) {
    const hint = document.createElement("div");
    hint.className = "sidebar-children-hint hidden";
    hint.innerHTML = `<span class="sidebar-ws-name">Show children</span> ${renderBadge("→")}`;
    hint.addEventListener("click", drillIntoSelectedParent);
    sidebarEl.appendChild(hint);
    hasHintsAbove = true;
  }

  // Hints-only views (currently just recently-closed) suppress the
  // workspace filter list since closed sessions have no live workspace.
  // The whole sidebar disappears when no row is selected so the view
  // doesn't reserve empty space; updateSelection re-shows it.
  if (opts?.hintsOnly) {
    sidebarEl.classList.add("sidebar-hints-only");
    sidebarEl.classList.toggle("hidden", ui.selectedIndex < 0);
    return;
  }

  if (hasHintsAbove) {
    const sep = document.createElement("div");
    sep.className = "sidebar-sep";
    // updateSelection runs before renderSidebar inside the renderTabList
    // flow, so the toggle there can't see this element. Bake the initial
    // hidden state in based on the same condition; updateSelection will
    // re-evaluate on every selection change.
    const anyVisibleHint = sidebarEl.querySelector(".sidebar-close-hint:not(.hidden), .sidebar-close-all-hint, .sidebar-restore-hint:not(.hidden), .sidebar-children-hint:not(.hidden)");
    if (!anyVisibleHint) sep.classList.add("hidden");
    sidebarEl.appendChild(sep);
  }

  if (sortOptions) {
    for (const opt of sortOptions) {
      const el = document.createElement("div");
      el.className = "sidebar-sort";
      el.innerHTML = `<span class="sidebar-ws-name">${escapeHtml(opt.label)}</span> ${renderBadge(opt.key)}`;
      el.addEventListener("click", opt.onClick);
      sidebarEl.appendChild(el);
    }
  }

  const heading = document.createElement("div");
  heading.className = "sidebar-heading";
  heading.textContent = "Filter by workspace";
  sidebarEl.appendChild(heading);

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

// View ids where rows represent a closed session that can be restored in
// place via the ↺ button (mouse) or O key (selection) without dismissing
// the palette. The existing click / Enter / 1-9 paths are unchanged and
// still flow through the dismissing RESTORE_CLOSED_TAB action.
const RESTOREABLE_VIEWS = new Set(["recently-closed"]);

// View ids where the sidebar should expose a "Close all" action that
// closes every row visible in the current list (e.g. close all children).
const CLOSE_ALL_VIEWS = new Set(["child-tabs"]);

// View ids whose rows lead to a deeper view via the sidebar "Show children"
// hint (→). Today only Parent tabs supports drilling, but the wiring is
// kept generic.
const DRILL_CHILDREN_VIEWS = new Set(["parent-tabs"]);

// Rows that arrow-key navigation should skip over: explicitly disabled
// rows (no chord/click target) plus the active workspace switcher (you
// can't switch to the workspace you're already in — its row also has no
// click handler).
function isUnselectableRow(el) {
  if (!el) return false;
  return el.classList.contains("disabled") || el.classList.contains("ws-active");
}

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
  const totalCount = ui.items.length;
  if (totalCount === 0) return;

  // On the actions menu, wrap selection within the current page so Space is
  // the only thing that crosses pages. Other views use the full ui.items
  // range as before.
  const [start, end] = currentPageBounds();
  const range = end - start;
  if (range <= 0) return;

  const wrap = (i) => start + ((i - start) % range + range) % range;

  if (ui.selectedIndex < start || ui.selectedIndex >= end) {
    ui.selectedIndex = delta > 0 ? start : end - 1;
  } else {
    ui.selectedIndex = wrap(ui.selectedIndex + delta);
  }

  // Skip unselectable rows (disabled / active-workspace) within the current range.
  const startIndex = ui.selectedIndex;
  const listItems = navigableListItems();
  while (isUnselectableRow(listItems[ui.selectedIndex])) {
    ui.selectedIndex = wrap(ui.selectedIndex + delta);
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

  // Restrict section-jump to the current page on the actions view, so Tab
  // doesn't sneak past a page boundary. Filter sectionStarts to those that
  // fall inside the current page's item range.
  const [pageStart, pageEnd] = currentPageBounds();
  const sections = ui.sectionStarts.filter((s) => s >= pageStart && s < pageEnd);
  if (sections.length === 0) return;

  // Find which section the current selection is in (within this page).
  // Use -1 to represent "no current section" so the first Tab from an
  // empty selection lands on sections[0] (first section), not sections[1].
  let currentSection = -1;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (ui.selectedIndex >= sections[i]) {
      currentSection = i;
      break;
    }
  }

  let targetSection;
  if (currentSection === -1) {
    // No selection yet — Tab goes to the first section, Shift+Tab to last.
    targetSection = delta > 0 ? 0 : sections.length - 1;
  } else {
    targetSection = currentSection + delta;
    if (targetSection < 0) targetSection = sections.length - 1;
    if (targetSection >= sections.length) targetSection = 0;
  }

  ui.selectedIndex = sections[targetSection];

  // Skip unselectable rows, wrapping within the page's range.
  const listItems = navigableListItems();
  const startIndex = ui.selectedIndex;
  const range = pageEnd - pageStart;
  while (isUnselectableRow(listItems[ui.selectedIndex])) {
    ui.selectedIndex = pageStart + ((ui.selectedIndex - pageStart + 1) % range);
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
  const listItems = navigableListItems();
  if (isUnselectableRow(listItems[ui.selectedIndex])) return;

  if (item.navIndex !== undefined && !item.isCurrent) {
    ext.runtime.sendMessage({ type: "navigate-to-history-index", index: item.navIndex }).catch(() => {});
  } else if (item.workspaceSwitchId) {
    ext.runtime.sendMessage({ type: "switch-workspace", workspaceId: item.workspaceSwitchId }).catch(() => {});
  } else if (item.launchProfileName) {
    ext.runtime.sendMessage({ type: "launch-profile", name: item.launchProfileName }).catch(() => {});
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
const paramParentDomId = urlParams.get("parentDomId");

async function init() {
  if (paramWorkspace) wsState.workspaceFilter = paramWorkspace;
  if (paramDomain) tabState.currentDomain = paramDomain;

  if (!initialView) {
    await showActionsMenu();
    return;
  }

  await fetchWorkspaceMap();
  const handler = VIEWS[initialView];
  if (handler) await handler({ domain: paramDomain, parentDomId: paramParentDomId });
}

init();