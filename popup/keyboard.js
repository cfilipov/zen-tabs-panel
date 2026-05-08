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
  if (!ui.sidebarFocused && ui.selectedIndex >= 0 && ui.items[ui.selectedIndex]?.isView) {
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
function handleActionsKey(e) {
  const num = parseInt(e.key, 10);
  if (!isNaN(num) && num >= 1 && num <= 9) {
    const wsItems = listEl.querySelectorAll(".list-item[data-workspace-switch-id]");
    for (const wsEl of wsItems) {
      const badge = wsEl.querySelector(".item-badge");
      if (badge && badge.textContent === String(num)) {
        e.preventDefault();
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
  const item = ui.items[idx];
  if (item.reorderAction) {
    ext.runtime.sendMessage({ type: item.reorderAction }).catch(() => {});
  } else if (item.closeAndSelectAction) {
    ext.runtime.sendMessage({ type: item.closeAndSelectAction }).catch(() => {});
  } else if (item.submenuAction) {
    ext.runtime.sendMessage({ type: item.submenuAction }).catch(() => {});
  } else {
    activateAction(item);
  }
}

// In list-style views (tab lists, history, domains, etc.), special keys
// are: B/F to step navigation history, S to toggle sort, 0 to toggle
// workspace filter, Shift+1-9 to filter to a specific workspace, and
// 1-9 to activate the badge-numbered list item.
function handleListViewKey(e) {
  // W: close the currently-selected tab in close-supporting views. Bare
  // letter only — must not be chordable, since the close target is the
  // arrow-key selection (not a registry entry).
  if ((e.key === "w" || e.key === "W") && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
      if (firstItem) activateTab(firstItem.dataset.domId);
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
    if (ds.domId) activateTab(ds.domId);
    return;
  }
}

document.addEventListener("keydown", (e) => {
  const handler = KEY_HANDLERS[e.key];
  if (handler) {
    handler(e);
    return;
  }
  if (ACTIONS_LIKE_VIEWS.has(ui.currentView)) {
    handleActionsKey(e);
  } else {
    handleListViewKey(e);
  }
});
