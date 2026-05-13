"use strict";

// Keyboard dispatch for the popup. The previous 178-line keydown listener
// is split into a static dispatch table for keys whose behavior is the
// same regardless of view, plus two view-conditional handlers (actions-
// like menus vs list views) for the catch-all "default" branch.
//
// Performance: KEY_HANDLERS is built once at script load using
// Object.create(null) so the keydown hot path skips a prototype walk.
// Lookup is O(1) by event-key string.

// Views that present like the actions menu: a static list of menu items
// where a single letter activates an item via item.hotkey.
const ACTIONS_LIKE_VIEWS = new Set(["actions", "reorder-tabs", "close-and-select", "split-view"]);

// Static dispatch — same behavior in every view.
const KEY_HANDLERS = Object.create(null);

KEY_HANDLERS["ArrowDown"] = (e) => {
  e.preventDefault();
  if (e.metaKey && !ui.sidebarFocused) {
    const [, end] = currentPageBounds();
    ui.selectedIndex = end - 1;
    updateSelection();
  } else if (ui.sidebarFocused) {
    moveSidebarSelection(1);
  } else {
    moveSelection(1);
  }
};

KEY_HANDLERS["ArrowUp"] = (e) => {
  e.preventDefault();
  if (e.metaKey && !ui.sidebarFocused) {
    const [start] = currentPageBounds();
    ui.selectedIndex = start;
    updateSelection();
  } else if (ui.sidebarFocused) {
    moveSidebarSelection(-1);
  } else {
    moveSelection(-1);
  }
};

KEY_HANDLERS["Tab"] = (e) => {
  e.preventDefault();
  jumpToSection(e.shiftKey ? -1 : 1);
};

KEY_HANDLERS["ArrowRight"] = (e) => {
  e.preventDefault();
  if (ui.sidebarFocused || ui.selectedIndex < 0) return;
  if (DRILL_CHILDREN_VIEWS.has(ui.currentView)) {
    drillIntoSelectedParent();
    return;
  }
  if (ui.items[ui.selectedIndex]?.isView) {
    activateSelected();
  }
};

KEY_HANDLERS["ArrowLeft"] = (e) => {
  e.preventDefault();
  if (!ui.sidebarFocused && ui.currentView !== "actions") goBack();
};

KEY_HANDLERS["Enter"] = (e) => {
  e.preventDefault();
  if (ui.sidebarFocused) activateSidebarSelected();
  else activateSelected();
};

KEY_HANDLERS["Escape"] = () => closePalette();

// Space cycles the actions menu page. Shift+Space cycles backward. Both wrap.
// Active only on the actions view — other views never bind Space, so a hidden
// quirk where a list view consumes Space won't fire by accident.
KEY_HANDLERS[" "] = (e) => {
  if (ui.currentView !== "actions") return;
  if (ui.pageCount <= 1) return;
  e.preventDefault();
  cycleActionsPage(e.shiftKey ? -1 : 1);
};

KEY_HANDLERS["Backspace"] = (e) => {
  if (ui.currentView !== "actions") {
    e.preventDefault();
    goBack();
  }
};

// In the actions menu (and similarly-structured submenus), a digit 1-9
// activates a workspace switch row, and a single letter matches an
// item.hotkey. These views never display tabs as numbered rows.
// Briefly add the .activated class to a list-item so the user can
// see which row they triggered. Distinct from .selected (gray arrow-
// key cursor) — uses the system AccentColor for an unambiguous
// "this is what fired" indicator. Called from chord-key matches,
// click handler, and Enter activation. Accepts either an index into
// navigableListItems() or the element directly.
function flashActivated(elOrIdx) {
  let el = null;
  if (typeof elOrIdx === "number") {
    if (elOrIdx < 0) return;
    const items = navigableListItems();
    el = items[elOrIdx];
  } else {
    el = elOrIdx;
  }
  if (!el || !el.classList) return;
  el.classList.add("activated");
  setTimeout(() => { try { el.classList.remove("activated"); } catch (e) {} }, 400);
}

function handleActionsKey(e) {
  // Shift+1..9 inside the actions view opens the Nth extension's popup
  // in our overlay (mirrors the page-1 footer strip). Bare 1..9 still
  // switches workspaces below.
  if (e.shiftKey && ui.currentView === "actions" && e.code && e.code.startsWith("Digit")) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 9) {
      const target = extState.list?.[n - 1];
      if (target) {
        e.preventDefault();
        ext.runtime.sendMessage({ type: "open-extension-popup", extensionId: target.id }).catch(() => {});
        return;
      }
    }
  }

  const num = parseInt(e.key, 10);
  if (!isNaN(num) && num >= 1 && num <= 9) {
    const wsItems = listEl.querySelectorAll(".list-item[data-workspace-switch-id]");
    for (let i = 0; i < wsItems.length; i++) {
      const wsEl = wsItems[i];
      const badge = wsEl.querySelector(".item-badge");
      if (badge && badge.textContent === String(num)) {
        e.preventDefault();
        const allListItems = navigableListItems();
        flashActivated(Array.prototype.indexOf.call(allListItems, wsEl));
        ext.runtime.sendMessage({ type: "switch-workspace", workspaceId: wsEl.dataset.workspaceSwitchId }).catch(() => {});
        return;
      }
    }
  }

  const key = chordFromEvent(e);
  const idx = ui.items.findIndex((item) => item.hotkey === key);
  if (idx < 0) return;

  const listItems = navigableListItems();
  if (listItems[idx]?.classList.contains("disabled")) return;

  e.preventDefault();
  flashActivated(idx);
  const item = ui.items[idx];
  const fire = () => {
    if (item.reorderAction) {
      ext.runtime.sendMessage({ type: item.reorderAction }).catch(() => {});
    } else if (item.closeAndSelectAction) {
      ext.runtime.sendMessage({ type: item.closeAndSelectAction }).catch(() => {});
    } else if (item.submenuAction) {
      ext.runtime.sendMessage({ type: item.submenuAction }).catch(() => {});
    } else {
      activateAction(item);
    }
  };
  // Briefly hold the menu visible (with the row showing the .activated
  // flash) before firing the action. Without this delay, the action's
  // navigateToView immediately replaces the visible content with the
  // cross-fade snapshot — the flash only shows on the snapshot mid-fade,
  // which is barely perceptible. Holding here renders the AccentColor
  // background on the real, painted DOM for ~100ms before the drill
  // starts, so the user sees a clear "this is what fired" indicator.
  setTimeout(fire, 100);
}

// In list-style views (tab lists, history, domains, etc.), special keys
// are: B/F to step navigation history, S to toggle sort, 0 to toggle
// workspace filter, Shift+1-9 to filter to a specific workspace, and
// 1-9 to activate the badge-numbered list item (or drill, for domains).
//
// Async because some digit matches drill into a sub-view via
// navigateToView, and chord chains in the bridge-replay path need to
// await the new view's render before processing subsequent keys.
async function handleListViewKey(e) {
  // W: close the currently-selected tab in close-supporting views.
  // Shift+W: close ALL rows in views that support it (e.g. children).
  // Bare letter — not chordable, since the targets here are the live list,
  // not registry entries.
  if ((e.key === "w" || e.key === "W") && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.shiftKey && CLOSE_ALL_VIEWS.has(ui.currentView)) {
      e.preventDefault();
      closeAllRowsInView();
      return;
    }
    if (CLOSEABLE_VIEWS.has(ui.currentView) && ui.selectedIndex >= 0) {
      e.preventDefault();
      closeSelectedRow();
    }
    return;
  }

  // O: restore the currently-selected closed-session row without
  // dismissing the palette (recently-closed view). Bare letter only;
  // existing click / Enter / 1-9 keep their dismissing behavior.
  if ((e.key === "o" || e.key === "O") && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (RESTOREABLE_VIEWS.has(ui.currentView) && ui.selectedIndex >= 0) {
      e.preventDefault();
      restoreSelectedRow();
    }
    return;
  }

  // B/F: step navigation history
  if (ui.currentView === "navigation") {
    const upper = e.key.toUpperCase();
    if (upper === "B" || upper === "F") {
      const current = ui.items.find((c) => c.isCurrent);
      const targetIdx = current ? current.navIndex + (upper === "B" ? -1 : 1) : null;
      const navItem = targetIdx != null
        ? ui.items.find((it) => it.navIndex === targetIdx)
        : null;
      if (navItem && !navItem.isCurrent) {
        e.preventDefault();
        ext.runtime.sendMessage({ type: "navigate-to-history-index", index: navItem.navIndex }).catch(() => {});
      }
      return;
    }
  }

  // S: toggle sort in domain or tabs-by-age views
  if (e.key.toUpperCase() === "S") {
    if (ui.currentView === "domains" || ui.currentView === "domain-tabs") {
      e.preventDefault();
      tabState.domainsSortAlpha = !tabState.domainsSortAlpha;
      refreshCurrentView();
      return;
    }
    if (ui.currentView === "tabs-by-age") {
      e.preventDefault();
      tabState.tabsByAgeNewestFirst = !tabState.tabsByAgeNewestFirst;
      refreshCurrentView();
      return;
    }
  }

  // 0: toggle workspace filter (all <-> current)
  if (e.key === "0" && !e.shiftKey && !sidebarEl.classList.contains("hidden")) {
    e.preventDefault();
    wsState.workspaceFilter = wsState.workspaceFilter === "all" ? wsState.activeWorkspaceId : "all";
    refreshCurrentView();
    return;
  }

  // Shift+1-9: filter to nth workspace
  if (e.shiftKey && !sidebarEl.classList.contains("hidden") && e.code && e.code.startsWith("Digit")) {
    const num = parseInt(e.code.slice(5), 10);
    if (num >= 1 && num <= 9) {
      const allWorkspaces = Object.entries(wsState.workspaceMap);
      const wsIndex = num - 1;
      if (wsIndex < allWorkspaces.length) {
        e.preventDefault();
        const uuid = allWorkspaces[wsIndex][0];
        wsState.workspaceFilter = wsState.workspaceFilter === uuid ? "all" : uuid;
        refreshCurrentView();
      }
      return;
    }
  }

  // 1-9: activate the list item with that badge
  const num = parseInt(e.key, 10);
  if (isNaN(num) || num < 1 || num > 9) return;

  // Split rows first — the badge sits on the row, not the inner items
  for (const row of listEl.querySelectorAll(".split-row")) {
    const badge = row.querySelector(".split-row-badge .item-badge");
    if (badge && badge.textContent === String(num)) {
      e.preventDefault();
      const firstItem = row.querySelector(".list-item[data-dom-id]");
      if (firstItem) {
        const allListItems = navigableListItems();
        flashActivated(Array.prototype.indexOf.call(allListItems, firstItem));
        activateTab(firstItem.dataset.domId);
      }
      return;
    }
  }

  // Regular items
  const listItems = listEl.querySelectorAll(".list-item");
  for (let i = 0; i < listItems.length; i++) {
    const badges = listItems[i].querySelectorAll(".item-badge");
    const matched = Array.from(badges).some((b) => b.textContent === String(num));
    if (!matched) continue;

    e.preventDefault();
    flashActivated(i);
    const item = ui.items[i];
    if (item?.navIndex !== undefined && !item?.isCurrent) {
      ext.runtime.sendMessage({ type: "navigate-to-history-index", index: item.navIndex }).catch(() => {});
      return;
    }
    const ds = listItems[i].dataset;
    if (ds.workspaceSwitchId) {
      ext.runtime.sendMessage({ type: "switch-workspace", workspaceId: ds.workspaceSwitchId }).catch(() => {});
      return;
    }
    if (ds.workspaceId) { moveToWorkspace(ds.workspaceId); return; }
    if (ds.sessionId) {
      ext.runtime.sendMessage({ type: "restore-closed-tab", sessionId: ds.sessionId }).catch(() => {});
      return;
    }
    // Domains view: each row carries data-domain. The click handler in
    // popup/views/domains.js drills into "domain-tabs" with that domain;
    // mirror that for digit selection so chord chains can navigate
    // deeper (cmd+., q, 1, 1).
    if (ds.domain) {
      await navigateToView("domain-tabs", { domain: ds.domain });
      return;
    }
    if (ds.domId) activateTab(ds.domId);
    return;
  }
}

// Async so chord-chain replay can await each key's effect (esp. drill
// navigation via navigateToView) before the next replay key dispatches.
async function dispatchKey(e) {
  // Anchor the reveal timer to the moment the key arrived, not to when
  // the handler finishes. The previous "arm at end" anchor added the
  // handler duration (~drill animation) to the perceived pause-to-
  // reveal delay; with cross-fade skipped during chord-chain (popup
  // invisible), handlers are short enough that arming at start is
  // safe — the next chord key resets the timer before it fires, and
  // the revealBlocked flag on destroyOverlay catches terminal-action
  // races.
  armPopupRevealTimer();
  const handler = KEY_HANDLERS[e.key];
  if (handler) {
    handler(e);
  } else if (ACTIONS_LIKE_VIEWS.has(ui.currentView)) {
    handleActionsKey(e);
  } else {
    await handleListViewKey(e);
  }
}

// Chord-bridge handshake: the chord engine in the experiment API may have
// buffered keystrokes during the gap between firing the chord outcome and
// this listener being live. Until those have been drained and replayed,
// hold any live keys we receive so we don't process them out of order.
let chordBridgeReady = false;
const heldLiveKeys = [];

function snapshotKeyEvent(e) {
  return {
    key: e.key, code: e.code,
    shiftKey: e.shiftKey, altKey: e.altKey,
    ctrlKey: e.ctrlKey, metaKey: e.metaKey,
  };
}

function makeSyntheticKeyEvent(d) {
  return new KeyboardEvent("keydown", { ...d, bubbles: false, cancelable: true });
}

// Serialize key dispatch through a queue. Without this, two keys typed
// fast (or two synthetic keys delivered via the chord engine's bridge
// after POPUP_READY) could enter dispatchKey concurrently while the
// first is awaiting navigateToView — the second would scan a stale
// view's items. The queue ensures each key's effect (esp. drill nav)
// settles before the next dispatches.
const liveDispatchQueue = [];
let liveDispatchRunning = false;

async function runLiveDispatchQueue() {
  if (liveDispatchRunning) return;
  liveDispatchRunning = true;
  try {
    while (liveDispatchQueue.length > 0) {
      const e = liveDispatchQueue.shift();
      await dispatchKey(e);
    }
  } finally {
    liveDispatchRunning = false;
  }
}

// Popup-side reveal-on-pause timer. After the popup has drained the bridge
// (POPUP_READY) it owns the "user paused, reveal the menu" decision —
// chrome's reveal timer is cleared in takeChordBridgeBuffer for non-empty
// drains. Each key dispatched (replay or live) resets this timer. When it
// fires we ask chrome to reveal.
//
// _popupInst is read from ?inst=N below. We echo it back so chrome can
// gate against a stale popup (destroyed in a prerender swap) firing
// reveal on its replacement.
let _popupInst = null;
// Chord delay (ms). Read from ?delay=N at IIFE start; falls back to
// CHORD_REVEAL_TIMEOUT_MS from shared/constants.js if missing.
let _popupChordDelay = CHORD_REVEAL_TIMEOUT_MS;
let popupRevealTimer = null;
function clearPopupRevealTimer() {
  if (popupRevealTimer !== null) {
    clearTimeout(popupRevealTimer);
    popupRevealTimer = null;
  }
}
function armPopupRevealTimer() {
  clearPopupRevealTimer();
  popupRevealTimer = setTimeout(() => {
    popupRevealTimer = null;
    _bridgeExt.runtime.sendMessage({
      type: MSG.REVEAL_PALETTE,
      inst: _popupInst,
    }).catch(() => {});
  }, _popupChordDelay);
}

// Stop the reveal timer if this popup is being torn down — keeps a
// destroyed prerender popup from firing reveal on its replacement.
window.addEventListener("pagehide", clearPopupRevealTimer);

// Expose so popup.js terminal-action helpers can cancel the timer
// before sending an activate/restore/etc. message. Without this, the
// pagehide event can lose the race against the timer (popup destroy
// is async via background → experiment API; the 400ms timer can fire
// first, revealing a popup that's already destroying → brief flash).
window.clearPopupRevealTimer = clearPopupRevealTimer;

document.addEventListener("keydown", (e) => {
  if (!chordBridgeReady) {
    e.preventDefault();
    e.stopPropagation();
    heldLiveKeys.push(snapshotKeyEvent(e));
    return;
  }
  // Live keystroke after drain — user is still active. Reset reveal timer
  // so we don't pop the menu in the middle of a chord chain that's been
  // typed faster than the drain processes.
  armPopupRevealTimer();
  liveDispatchQueue.push(e);
  runLiveDispatchQueue();
});

// keyboard.js loads before popup.js, so `ext` is in its TDZ here. Use the
// browser/chrome fallback directly for the handshake.
const _bridgeExt = typeof browser !== "undefined" ? browser : chrome;

(async () => {
  // Read the popup-instance id from URL (?inst=N) so chrome can tell
  // whether this POPUP_READY came from the current popup or a stale one
  // (prerender-swap during a chord chain). Stale POPUP_READYs must not
  // drain the bridge buffer — those keys belong to the live popup.
  const _params = new URLSearchParams(location.search);
  const _inst = parseInt(_params.get("inst") || "", 10);
  _popupInst = Number.isFinite(_inst) ? _inst : null;
  const _delay = parseInt(_params.get("delay") || "", 10);
  if (Number.isFinite(_delay) && _delay >= 0) {
    _popupChordDelay = _delay;
  }

  let buffered = [];
  let isStale = false;
  let targetView = null;
  try {
    const reply = await _bridgeExt.runtime.sendMessage({
      type: MSG.POPUP_READY,
      inst: _popupInst,
    });
    // POPUP_READY reply shape: { buffered, stateSnapshot, stale?, view? }.
    // The buffered array is keys the chord engine captured during the
    // chord-fires-open-view → popup-keyboard-attached gap. stale is set
    // by chrome when this popup's `inst` doesn't match the current popup
    // (a prerender-swap left us as a soon-to-be-destroyed instance).
    // view is set when chrome arrived at a non-default view during a
    // chord arm that landed mid-popup-load (WarmRearm message dropped) —
    // we navigate to it before replaying so buffered chord-chain keys
    // operate at the right view.
    if (reply && reply.stale) isStale = true;
    if (reply && Array.isArray(reply.buffered)) buffered = reply.buffered;
    else if (Array.isArray(reply)) buffered = reply; // backwards-compat
    if (reply && typeof reply.view === "string") targetView = reply.view;
  } catch (err) {
    // Background may not yet be ready, or there's no bridge to drain; either
    // way, fall through and just process any held live keys.
  }

  // Stale instance — chrome will drain our buffer into the live popup.
  // Don't process live keys here either; this popup is being torn down.
  if (isStale) return;

  // Wait for popup.js's init() to fully render the initial view BEFORE
  // dispatching buffered keys. Otherwise handleListViewKey scans
  // listEl.querySelectorAll(".list-item") before items exist and silently
  // drops digits (the classic cmd+., r, 1 fast-chain bug).
  try { await window.__popupReady; } catch (e) { /* init failed; proceed anyway */ }

  // Belt and suspenders: also wait for DOMContentLoaded + a frame in case
  // window.__popupReady isn't yet available (script load order quirk).
  if (document.readyState === "loading") {
    await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  }
  await new Promise((r) => requestAnimationFrame(r));

  // Navigate to the chord's target view if chrome reported one and we
  // aren't already there (the user chorded faster than the WarmRearm
  // message could attach — see takeChordBridgeBuffer's `view` reply).
  if (targetView && typeof VIEWS !== "undefined" && typeof ui !== "undefined" && ui.currentView !== targetView) {
    const handler = VIEWS[targetView];
    if (handler) {
      try { await handler({}); } catch (e) {}
      if (typeof requestPanelResize === "function") requestPanelResize(targetView);
    }
  }

  // Each replay is awaited so chord chains involving drill navigation
  // (e.g. cmd+., q, 1, 1: drill into first domain, then activate
  // first tab) sequence correctly — handleListViewKey awaits
  // navigateToView, so the second digit sees the new view's items.
  //
  // Each dispatchKey() call arms the reveal timer at dispatch time, so
  // the last key's arm time is "wall-clock when that key arrived",
  // anchoring the 400ms pause to user input rather than to when the
  // drain finished. For the empty-drain case there's no per-key arm,
  // so we arm once here as the fallback for "popup loaded into a
  // chord-bridge but user typed nothing further" — chrome's own
  // reveal timer covers the common case (and fires first if still
  // armed), this is the safety net.
  for (const k of buffered) await dispatchKey(makeSyntheticKeyEvent(k));
  for (const k of heldLiveKeys) await dispatchKey(makeSyntheticKeyEvent(k));
  heldLiveKeys.length = 0;
  chordBridgeReady = true;

  if (buffered.length === 0 && heldLiveKeys.length === 0) {
    armPopupRevealTimer();
  }
})();

// Warm-popup rearm handler. The warm overlay's popup browser stays loaded
// across chord chains — instead of being torn down and recreated, chrome
// sends a ZenChord:WarmRearm MM message which the frame script dispatches
// as a `ztt:warm-rearm` CustomEvent here. We reset the popup's UI state,
// navigate to the requested view, then signal POPUP_READY (just like the
// IIFE above) so chrome drains any chord-chain keys that arrived in the
// rearm window.
//
// A generation counter discards stale rearms: if a second rearm message
// arrives before the first finishes (e.g. cmd+. typed twice fast, or a
// prefix descent followed quickly by an open-view match), the older
// handler bails before mutating UI state.
let warmRearmGen = 0;

async function handleWarmRearm(data) {
  const myGen = ++warmRearmGen;
  if (typeof data.inst === "number") _popupInst = data.inst;
  chordBridgeReady = false;
  clearPopupRevealTimer();
  // The previous chain's leftover keys (buffered live keys, queued
  // dispatches) are stale for a fresh chord chain — discard them.
  liveDispatchQueue.length = 0;
  heldLiveKeys.length = 0;

  // Clear preview / hover state from the previous chain so a new view
  // doesn't inherit a stale tab outline.
  _bridgeExt.runtime.sendMessage({ type: MSG.CLEAR_PREVIEW }).catch(() => {});

  // Reset selection / pagination so the rendered view starts on page 1
  // with no row selected. Without this, dismissing the menu on page 2
  // (or with a sidebar focused / row highlighted) leaks that state into
  // the next cmd+. since the warm popup is reused.
  if (typeof ui !== "undefined") {
    ui.selectedIndex = -1;
    ui.currentPage = 1;
    ui.sidebarFocused = false;
  }

  const view = data.view || "actions";
  const params = data.params || {};
  const handler = (typeof VIEWS !== "undefined") ? VIEWS[view] : null;
  if (handler) {
    try { await handler(params); } catch (e) {}
  }
  if (myGen !== warmRearmGen) return;

  // Resize to fit the rendered content (popup.js helper, in scope via
  // shared script-globals). If popup.js hasn't loaded yet — e.g. a
  // chord arm landed mid-popup-load — fall back to a view-only resize
  // so chrome still updates the preset width.
  if (typeof requestPanelResize === "function") {
    requestPanelResize(view);
  } else {
    _bridgeExt.runtime.sendMessage({ type: MSG.RESIZE_PANEL, view }).catch(() => {});
  }

  // Same POPUP_READY exchange as the IIFE. The inst echoed here tells
  // chrome to drain into THIS rearm cycle (stale inst → bg returns
  // { stale: true }, we bail without replaying).
  let buffered = [];
  let isStale = false;
  try {
    const reply = await _bridgeExt.runtime.sendMessage({
      type: MSG.POPUP_READY,
      inst: _popupInst,
    });
    if (reply && reply.stale) isStale = true;
    if (reply && Array.isArray(reply.buffered)) buffered = reply.buffered;
    else if (Array.isArray(reply)) buffered = reply;
  } catch (e) {}

  if (isStale || myGen !== warmRearmGen) return;

  for (const k of buffered) await dispatchKey(makeSyntheticKeyEvent(k));
  for (const k of heldLiveKeys) await dispatchKey(makeSyntheticKeyEvent(k));
  heldLiveKeys.length = 0;

  if (myGen !== warmRearmGen) return;
  chordBridgeReady = true;

  if (buffered.length === 0) armPopupRevealTimer();
}

document.addEventListener("ztt:warm-rearm", (e) => {
  let data = {};
  try { data = JSON.parse(e.detail); } catch (err) {}
  handleWarmRearm(data);
});

// Chrome dismissed the overlay — kill any in-flight reveal-on-pause
// timer so it doesn't fire ~350ms later and race past revealBlocked
// in the next chord arm to re-reveal the popup.
document.addEventListener("ztt:cancel-reveal", () => {
  clearPopupRevealTimer();
});
