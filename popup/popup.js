"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentView = "actions";
let selectedIndex = -1;
let items = [];
let currentTabHasParent = false;
let childTabCount = 0;
let unvisitedTabCount = 0;
let parentTabPreview = null;  // { title, favIconUrl }
let previousTabPreview = null; // { title, favIconUrl }
let selectedTabCount = 0;

const listEl = document.getElementById("list");
const headerEl = document.getElementById("header");
const backButton = document.getElementById("back-button");
const viewTitle = document.getElementById("view-title");

const ext = typeof browser !== "undefined" ? browser : chrome;

// Fire-and-forget — don't await since the overlay destruction kills our context
function closePalette() {
  ext.runtime.sendMessage({ type: "hide-palette" }).catch(() => {});
}

function activateTab(domId) {
  // activate-tab handler in background.js closes the palette and switches
  ext.runtime.sendMessage({ type: "activate-tab", domId }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Actions menu definition
// ---------------------------------------------------------------------------

function getActions() {
  return [
    { id: "go-to-previous-tab", label: "Previous", hotkey: "P", icon: "↔", preview: previousTabPreview },
    { id: "go-to-parent-tab", label: "Parent", hotkey: "U", icon: "↑", needsParent: true, preview: parentTabPreview },
    { id: "child-tabs", label: "Children", hotkey: "C", icon: "↓", isView: true, needsChildren: true, count: childTabCount },
    { id: "unvisited-tabs", label: "New tabs", hotkey: "N", icon: "●", isView: true, needsUnvisited: true, count: unvisitedTabCount },
    { id: "last-visited", label: "Recent", hotkey: "L", icon: "◷", isView: true },
    { type: "separator" },
    { id: "move-to-workspace", label: "Move to workspace", hotkey: "M", icon: "⇥", isView: true, count: selectedTabCount > 1 ? selectedTabCount : 0 },
    { id: "move-tab-to-start", label: "Move to start", hotkey: "S", icon: "⤒" },
    { id: "move-tab-to-end", label: "Move to end", hotkey: "E", icon: "⤓" },
    { id: "sort-tabs", label: "Sort by recent", hotkey: "O", icon: "⇅" },
    { id: "sort-tabs-domain", label: "Sort by domain", hotkey: "G", icon: "⇅" },
    { id: "unload-tab", label: "Unload", hotkey: "D", icon: "⏻" },
    { type: "separator" },
    { id: "settings", label: "Settings", hotkey: "," , icon: "svg:gear" },
  ];
}

// ---------------------------------------------------------------------------
// Icon rendering — SVG icons for consistent sizing
// ---------------------------------------------------------------------------

const SVG_ICONS = {
  gear: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
};

function getIcon(icon) {
  if (!icon) return "";
  if (icon.startsWith("svg:")) return SVG_ICONS[icon.slice(4)] || "";
  return icon;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function isActionDisabled(action) {
  if (action.needsParent && !currentTabHasParent) return true;
  if (action.needsChildren && childTabCount === 0) return true;
  if (action.needsUnvisited && unvisitedTabCount === 0) return true;
  return false;
}

function renderActions(actions, title) {
  items = actions.filter((a) => a.type !== "separator");
  selectedIndex = -1;

  listEl.innerHTML = "";

  for (const action of actions) {
    if (action.type === "separator") {
      const sep = document.createElement("div");
      sep.className = "list-separator";
      listEl.appendChild(sep);
      continue;
    }

    const disabled = isActionDisabled(action);

    const el = document.createElement("div");
    el.className = "list-item" + (disabled ? " disabled" : "");
    el.dataset.id = action.id;

    // Build preview HTML for Previous/Parent
    let previewHtml = "";
    if (action.preview && !disabled) {
      const canLoad = action.preview.favIconUrl && !action.preview.favIconUrl.startsWith("chrome://");
      const iconHtml = canLoad
        ? `<img class="preview-icon" src="${escapeAttr(action.preview.favIconUrl)}">`
        : `<span class="preview-icon-placeholder">○</span>`;
      const previewTitle = escapeHtml(action.preview.title || "Untitled");
      previewHtml = `<span class="action-preview">${iconHtml}<span class="preview-title">${previewTitle}</span></span>`;
    }

    // Build count badge
    let countHtml = "";
    if (typeof action.count === "number" && action.count > 0) {
      countHtml = `<span class="item-count">${action.count}</span>`;
    }

    const rightContent = `
      ${previewHtml}
      ${action.hotkey ? `<span class="item-badge">${action.hotkey}</span>` : ""}
      <span class="item-arrow">${action.isView ? "›" : ""}</span>
    `;

    el.innerHTML = `
      <span class="item-icon-placeholder">${getIcon(action.icon)}</span>
      <span class="item-text">
        <span class="item-title">${action.label}${countHtml}</span>
      </span>
      <span class="item-right">${rightContent}</span>
    `;

    // Handle preview icon errors
    const img = el.querySelector("img.preview-icon");
    if (img) {
      img.addEventListener("error", () => { img.style.display = "none"; });
    }

    if (!disabled) {
      el.addEventListener("click", () => activateAction(action));
    }
    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader(title);
}

function renderTabList(tabs, title) {
  selectedIndex = -1;
  listEl.innerHTML = "";

  if (tabs.length === 0) {
    items = [];
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader(title);
    return;
  }

  // Build render order: group split siblings together
  const rendered = new Set();
  const orderedItems = [];
  let slotIndex = 0; // tracks the 0-9 keybinding slot

  for (let i = 0; i < tabs.length; i++) {
    if (rendered.has(i)) continue;

    const tab = tabs[i];
    const badge = slotIndex < 10 ? String(slotIndex) : null;

    if (tab.splitGroupId) {
      const siblings = [];
      for (let j = 0; j < tabs.length; j++) {
        if (tabs[j].splitGroupId === tab.splitGroupId) {
          siblings.push({ tab: tabs[j], index: j });
        }
      }

      if (siblings.length > 1) {
        const rowEl = document.createElement("div");
        rowEl.className = "split-row";

        const pairEl = document.createElement("div");
        pairEl.className = "split-pair";

        for (let s = 0; s < siblings.length; s++) {
          const sib = siblings[s];
          rendered.add(sib.index);
          orderedItems.push(sib.tab);

          if (s > 0) {
            const sep = document.createElement("div");
            sep.className = "split-pair-indicator";
            sep.textContent = "┃";
            pairEl.appendChild(sep);
          }

          pairEl.appendChild(createTabElement(sib.tab, null));
        }

        rowEl.appendChild(pairEl);

        if (badge !== null) {
          const badgeEl = document.createElement("span");
          badgeEl.className = "split-row-badge";
          badgeEl.innerHTML = `<span class="item-badge">${badge}</span>`;
          rowEl.appendChild(badgeEl);
        }

        listEl.appendChild(rowEl);
        slotIndex++;
        continue;
      }
    }

    rendered.add(i);
    orderedItems.push(tab);
    listEl.appendChild(createTabElement(tab, badge));
    slotIndex++;
  }

  items = orderedItems;
  updateSelection();
  updateHeader(title);
}

function createTabElement(tab, badge) {
  const el = document.createElement("div");
  el.className = "list-item";
  el.dataset.domId = tab.domId;

  let domain = "";
  try {
    domain = new URL(tab.url).hostname;
  } catch (e) {}

  // Filter out chrome:// favicon URLs (not loadable from extension context)
  const canLoadFavicon = tab.favIconUrl &&
    !tab.favIconUrl.startsWith("chrome://");

  el.innerHTML = `
    ${canLoadFavicon
      ? `<img class="item-icon" src="${escapeAttr(tab.favIconUrl)}">`
      : `<span class="item-icon-placeholder">○</span>`}
    <span class="item-text">
      <span class="item-title">${escapeHtml(tab.title || "Untitled")}</span>
      ${domain ? `<span class="item-subtitle">${escapeHtml(domain)}</span>` : ""}
    </span>
    ${badge !== null ? `<span class="item-right"><span class="item-badge">${badge}</span></span>` : ""}
  `;

  // Attach error handler via JS instead of inline onerror (CSP blocks inline handlers)
  const img = el.querySelector("img.item-icon");
  if (img) {
    img.addEventListener("error", () => { img.style.display = "none"; });
  }

  el.addEventListener("click", () => activateTab(tab.domId));
  return el;
}

function updateHeader(title) {
  if (!title) {
    headerEl.classList.add("hidden");
    backButton.classList.add("hidden");
    viewTitle.textContent = "";
    return;
  }

  headerEl.classList.remove("hidden");
  backButton.classList.remove("hidden");
  viewTitle.textContent = title;
}

function updateSelection() {
  const listItems = listEl.querySelectorAll(".list-item");
  listItems.forEach((el, i) => {
    el.classList.toggle("selected", i === selectedIndex);
  });

  if (selectedIndex >= 0) {
    const selected = listItems[selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }
}

function animateList(direction) {
  listEl.classList.remove("animate-forward", "animate-back");
  // Force reflow so re-adding the same class triggers animation
  void listEl.offsetWidth;
  listEl.classList.add(direction === "forward" ? "animate-forward" : "animate-back");
  listEl.addEventListener("animationend", () => {
    listEl.classList.remove("animate-forward", "animate-back");
  }, { once: true });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function moveSelection(delta) {
  const count = items.length;
  if (count === 0) return;

  if (selectedIndex === -1) {
    selectedIndex = delta > 0 ? 0 : count - 1;
  } else {
    selectedIndex = (selectedIndex + delta + count) % count;
  }

  // Skip disabled items
  const startIndex = selectedIndex;
  const listItems = listEl.querySelectorAll(".list-item");
  while (listItems[selectedIndex]?.classList.contains("disabled")) {
    selectedIndex = (selectedIndex + delta + count) % count;
    if (selectedIndex === startIndex) break;
  }

  updateSelection();
}

function activateSelected() {
  if (selectedIndex < 0 || items.length === 0) return;

  const item = items[selectedIndex];
  const listItems = listEl.querySelectorAll(".list-item");
  if (listItems[selectedIndex]?.classList.contains("disabled")) return;

  if (item.id && typeof item.hotkey !== "undefined") {
    activateAction(item);
  } else if (item.uuid) {
    moveToWorkspace(item.uuid);
  } else if (item.domId) {
    activateTab(item.domId);
  }
}

function activateAction(action) {
  switch (action.id) {
    case "go-to-previous-tab":
    case "go-to-parent-tab":
    case "move-tab-to-start":
    case "move-tab-to-end":
    case "unload-tab":
      // Background handlers close the palette themselves
      ext.runtime.sendMessage({ type: action.id }).catch(() => {});
      break;

    case "sort-tabs":
      ext.runtime.sendMessage({ type: "sort-tabs-by-recent" }).catch(() => {});
      break;

    case "sort-tabs-domain":
      ext.runtime.sendMessage({ type: "sort-tabs-by-domain" }).catch(() => {});
      break;

    case "settings":
      ext.runtime.sendMessage({ type: "open-options" }).catch(() => {});
      break;

    case "move-to-workspace":
      showMoveToWorkspace();
      break;

    case "child-tabs":
      showChildTabs();
      break;

    case "unvisited-tabs":
      showUnvisitedTabs();
      break;

    case "last-visited":
      showLastVisited();
      break;
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function showActionsMenu() {
  currentView = "actions";

  // Fetch tab info for disabling unavailable actions and previews
  try {
    const allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
    const activeTab = allTabs.find((t) => t.active);
    currentTabHasParent = !!(activeTab && activeTab.openerTabDomId);
    childTabCount = activeTab ? allTabs.filter((t) => t.openerTabDomId === activeTab.domId).length : 0;
    unvisitedTabCount = allTabs.filter((t) => t.unread).length;

    // Parent tab preview
    if (currentTabHasParent) {
      const parent = allTabs.find((t) => t.domId === activeTab.openerTabDomId);
      parentTabPreview = parent ? { title: parent.title, favIconUrl: parent.favIconUrl } : null;
    } else {
      parentTabPreview = null;
    }

    // Previous tab preview — most recently accessed tab excluding current and split siblings
    const visibleDomIds = new Set();
    if (activeTab) visibleDomIds.add(activeTab.domId);
    if (activeTab?.splitGroupId) {
      allTabs.filter((t) => t.splitGroupId === activeTab.splitGroupId).forEach((t) => visibleDomIds.add(t.domId));
    }
    const candidates = allTabs
      .filter((t) => !visibleDomIds.has(t.domId) && !t.unread)
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    previousTabPreview = candidates.length > 0
      ? { title: candidates[0].title, favIconUrl: candidates[0].favIconUrl }
      : null;

    // Fetch selected tab count for "Move to workspace" badge
    try {
      const selectedDomIds = await ext.runtime.sendMessage({ type: "get-selected-tab-dom-ids" });
      selectedTabCount = selectedDomIds.length;
    } catch (e) {
      selectedTabCount = 0;
    }
  } catch (e) {
    currentTabHasParent = false;
    childTabCount = 0;
    unvisitedTabCount = 0;
    parentTabPreview = null;
    previousTabPreview = null;
    selectedTabCount = 0;
  }

  renderActions(getActions(), null);
}

async function showChildTabs() {
  currentView = "child-tabs";

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    renderTabList([], "Children");
    return;
  }

  const activeTab = allTabs.find((t) => t.active);
  if (!activeTab) {
    renderTabList([], "Children");
    return;
  }

  const children = allTabs.filter((t) => t.openerTabDomId === activeTab.domId);
  renderTabList(children, "Children");
  animateList("forward");
}

async function showUnvisitedTabs() {
  currentView = "unvisited";

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    renderTabList([], "New tabs");
    return;
  }

  const unvisited = allTabs.filter((t) => t.unread);
  renderTabList(unvisited, "New tabs");
  animateList("forward");
}

async function showLastVisited() {
  currentView = "last-visited";

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    renderTabList([], "Recent");
    return;
  }

  allTabs.sort((a, b) => b.lastAccessed - a.lastAccessed);

  // Find the current tab to determine if we're in a split view
  const activeTab = allTabs.find((t) => t.active);
  const activeSplitGroupId = activeTab?.splitGroupId;

  const filtered = allTabs.filter((t) => {
    if (t.active) return false;
    // Only filter tabs in the same split group as the current tab
    if (activeSplitGroupId && t.splitGroupId === activeSplitGroupId) return false;
    return true;
  });
  renderTabList(filtered, "Recent");
  animateList("forward");
}

async function showMoveToWorkspace() {
  currentView = "move-to-workspace";
  let workspaces;
  try {
    workspaces = await ext.runtime.sendMessage({ type: "get-workspaces-with-icons" });
  } catch (e) { workspaces = []; }
  const otherWorkspaces = workspaces.filter(ws => !ws.isActive);
  renderWorkspaceList(otherWorkspaces, "Move to workspace");
  animateList("forward");
}

function renderWorkspaceList(workspaces, title) {
  selectedIndex = -1;
  listEl.innerHTML = "";

  if (workspaces.length === 0) {
    items = [];
    listEl.innerHTML = `<div class="empty-state">No other workspaces</div>`;
    updateHeader(title);
    return;
  }

  items = workspaces;

  for (let i = 0; i < workspaces.length; i++) {
    const ws = workspaces[i];
    const badge = i < 10 ? String(i) : null;

    const el = document.createElement("div");
    el.className = "list-item";
    el.dataset.workspaceId = ws.uuid;

    const iconHtml = ws.svgContent
      ? `<span class="workspace-icon">${ws.svgContent}</span>`
      : `<span class="item-icon-placeholder">○</span>`;

    el.innerHTML = `
      ${iconHtml}
      <span class="item-text">
        <span class="item-title">${escapeHtml(ws.name)}</span>
      </span>
      ${badge !== null ? `<span class="item-right"><span class="item-badge">${badge}</span></span>` : ""}
    `;

    el.addEventListener("click", () => moveToWorkspace(ws.uuid));
    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader(title);
}

function moveToWorkspace(workspaceId) {
  ext.runtime.sendMessage({ type: "move-selected-tabs-to-workspace", workspaceId }).catch(() => {});
}

function goBack() {
  if (currentView !== "actions") {
    showActionsMenu();
    animateList("back");
  }
}

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      moveSelection(1);
      break;

    case "ArrowUp":
      e.preventDefault();
      moveSelection(-1);
      break;

    case "ArrowRight":
      e.preventDefault();
      if (selectedIndex >= 0 && items[selectedIndex]?.isView) {
        activateSelected();
      }
      break;

    case "ArrowLeft":
      if (currentView !== "actions") {
        e.preventDefault();
        goBack();
      }
      break;

    case "Enter":
      e.preventDefault();
      activateSelected();
      break;

    case "Escape":
      if (currentView !== "actions") {
        e.preventDefault();
        goBack();
      } else {
        closePalette();
      }
      break;

    case "Backspace":
      if (currentView !== "actions") {
        e.preventDefault();
        goBack();
      }
      break;

    default:
      if (currentView === "actions") {
        const key = e.key.toUpperCase();
        const idx = items.findIndex((item) => item.hotkey === key);
        if (idx >= 0) {
          const listItems = listEl.querySelectorAll(".list-item");
          if (!listItems[idx]?.classList.contains("disabled")) {
            e.preventDefault();
            activateAction(items[idx]);
          }
        }
      } else {
        // Number keys 0-9 activate tabs in list views
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 0 && num <= 9) {
          // Check split rows first
          const splitRows = listEl.querySelectorAll(".split-row");
          for (const row of splitRows) {
            const badge = row.querySelector(".split-row-badge .item-badge");
            if (badge && badge.textContent === String(num)) {
              e.preventDefault();
              // Activate the first tab in the split pair
              const firstItem = row.querySelector(".list-item[data-dom-id]");
              if (firstItem) activateTab(firstItem.dataset.domId);
              return;
            }
          }
          // Then check regular items
          const listItems = listEl.querySelectorAll(".list-item");
          for (let i = 0; i < listItems.length; i++) {
            const badge = listItems[i].querySelector(".item-badge");
            if (badge && badge.textContent === String(num)) {
              e.preventDefault();
              const wsId = listItems[i].dataset.workspaceId;
              if (wsId) { moveToWorkspace(wsId); break; }
              const domId = listItems[i].dataset.domId;
              if (domId) activateTab(domId);
              break;
            }
          }
        }
      }
      break;
  }
});

backButton.addEventListener("click", goBack);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Theme — sync with Zen's dark/light mode
// ---------------------------------------------------------------------------

const urlParams = new URLSearchParams(window.location.search);
const theme = urlParams.get("theme") || "dark";
document.documentElement.style.colorScheme = theme;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

showActionsMenu();