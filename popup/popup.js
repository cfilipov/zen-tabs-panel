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
let workspaceMap = {};     // uuid → { name, svgContent }
let activeWorkspaceId = null;
let duplicateGroupCount = 0;
let siblingTabCount = 0;
let parentTabCount = 0;
let domainCount = 0;
let recentlyClosedCount = 0;

const listEl = document.getElementById("list");
const headerEl = document.getElementById("header");
const backButton = document.getElementById("back-button");
const viewTitle = document.getElementById("view-title");
const headerHint = document.getElementById("header-hint");
const sidebarEl = document.getElementById("sidebar");

let workspaceFilter = "all";
let workspaceTabCounts = {};
let currentDomain = null;
let tabsByAgeNewestFirst = false;
let domainsSortAlpha = false;
let sectionStarts = [];
let sidebarFocused = false;
let sidebarSelectedIndex = -1;

const ext = typeof browser !== "undefined" ? browser : chrome;

// Fire-and-forget — don't await since the overlay destruction kills our context
function closePalette() {
  ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  ext.runtime.sendMessage({ type: "hide-palette" }).catch(() => {});
}

function activateTab(domId) {
  // activate-tab handler in background.js closes the palette and switches
  ext.runtime.sendMessage({ type: "activate-tab", domId }).catch(() => {});
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
// Actions menu definition
// ---------------------------------------------------------------------------

// Build a popup menu item from a registry entry, merging runtime-computed
// fields (preview, count). Layout flags (compact, etc.) are added by callers.
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
  for (const flag of ["needsParent", "needsChildren", "needsSiblings", "needsParentTabs", "needsUnvisited", "needsDuplicates", "needsRecentlyClosed"]) {
    if (entry[flag]) base[flag] = true;
  }
  return Object.assign(base, extra);
}

function getActions() {
  const compact = { compact: true };
  return [
    actionFromRegistry("go-to-previous-tab", { preview: previousTabPreview }),
    actionFromRegistry("go-to-parent-tab",   { preview: parentTabPreview }),
    { type: "separator" },
    actionFromRegistry("child-tabs",      { count: childTabCount, ...compact }),
    actionFromRegistry("sibling-tabs",    { count: siblingTabCount, ...compact }),
    actionFromRegistry("parent-tabs",     { count: parentTabCount, ...compact }),
    actionFromRegistry("navigation",      compact),
    actionFromRegistry("unvisited-tabs",  { count: unvisitedTabCount, ...compact }),
    actionFromRegistry("last-visited",    compact),
    actionFromRegistry("recently-closed", { count: recentlyClosedCount, ...compact }),
    actionFromRegistry("duplicates",      { count: duplicateGroupCount, ...compact }),
    actionFromRegistry("tab-info",        compact),
    actionFromRegistry("domains",         { count: domainCount, ...compact }),
    actionFromRegistry("tabs-by-age",     compact),
    actionFromRegistry("most-visited",    compact),
    { type: "separator" },
    actionFromRegistry("move-tab-to-start",     compact),
    actionFromRegistry("move-tab-to-end",       compact),
    actionFromRegistry("reorder-tabs",          compact),
    actionFromRegistry("move-to-workspace",     { count: selectedTabCount > 1 ? selectedTabCount : 0, ...compact }),
    actionFromRegistry("scroll-to-current-tab", compact),
    actionFromRegistry("unload-tab",            compact),
    actionFromRegistry("close-and-select",      compact),
    actionFromRegistry("open-options",          compact),
    { type: "separator" },
    { type: "workspaces" },
  ];
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
  "gear": `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
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
  if (action.needsSiblings && siblingTabCount === 0) return true;
  if (action.needsParentTabs && parentTabCount === 0) return true;
  if (action.needsDuplicates && duplicateGroupCount === 0) return true;
  if (action.needsRecentlyClosed && recentlyClosedCount === 0) return true;
  return false;
}

function renderActions(actions, title) {
  actions = actions.filter(Boolean);
  items = actions.filter((a) => a.type !== "separator" && a.type !== "workspaces");
  selectedIndex = -1;
  sectionStarts = [0];

  listEl.innerHTML = "";
  let gridContainer = null;
  let itemIndex = 0;

  for (const action of actions) {
    if (action.type === "separator") {
      gridContainer = null;
      const sep = document.createElement("div");
      sep.className = "list-separator";
      listEl.appendChild(sep);
      sectionStarts.push(itemIndex);
      continue;
    }

    if (action.type === "workspaces") {
      gridContainer = null;
      renderWorkspaceSwitcher(listEl);
      continue;
    }

    const disabled = isActionDisabled(action);

    const el = document.createElement("div");
    el.className = "list-item" + (disabled ? " disabled" : "") + (action.compact ? " compact-item" : "");
    el.dataset.id = action.id;

    // Build preview HTML for Previous/Parent
    let previewHtml = "";
    if (action.preview && !disabled) {
      let prevFav = action.preview.favIconUrl || "";
      if (prevFav.startsWith("moz-remote-image://")) {
        try { prevFav = new URL(prevFav).searchParams.get("url") || ""; } catch (e) { prevFav = ""; }
      }
      const canLoad = prevFav && !prevFav.startsWith("chrome://");
      const iconHtml = canLoad
        ? `<img class="preview-icon" src="${escapeAttr(prevFav)}">`
        : `<span class="preview-icon-placeholder">○</span>`;
      const previewTitle = escapeHtml(action.preview.title || "Untitled");
      let wsLabel = "";
      if (action.preview.workspaceId && action.preview.workspaceId !== activeWorkspaceId) {
        const ws = workspaceMap[action.preview.workspaceId];
        if (ws) {
          const wsIcon = ws.svgContent ? `<span class="row-ws-icon">${ws.svgContent}</span>` : "";
          wsLabel = `<span class="row-workspace">${wsIcon}${escapeHtml(ws.name)}</span>`;
        }
      }
      const previewPendingCls = action.preview.pending ? " tab-pending" : "";
      previewHtml = `<span class="action-preview${previewPendingCls}">${iconHtml}<span class="preview-title">${previewTitle}</span>${wsLabel}</span>`;
    }

    // Build count badge
    let countHtml = "";
    if (typeof action.count === "number" && action.count > 0) {
      countHtml = `<span class="item-count">${action.count}</span>`;
    }

    const rightContent = `
      ${previewHtml}
      ${renderBadge(displayKey(action.hotkey))}
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
      if (action.preview?.domId) {
        el.addEventListener("mouseenter", () => {
          ext.runtime.sendMessage({ type: "preview-tab", domId: action.preview.domId }).catch(() => {});
        });
        el.addEventListener("mouseleave", () => {
          ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
        });
      }
    }

    if (action.compact) {
      if (!gridContainer) {
        gridContainer = document.createElement("div");
        gridContainer.className = "actions-grid";
        listEl.appendChild(gridContainer);
      }
      gridContainer.appendChild(el);
    } else {
      gridContainer = null;
      listEl.appendChild(el);
    }
    itemIndex++;
  }

  updateSelection();
  updateHeader(title);
}

function renderTabList(tabs, title, hint) {
  selectedIndex = -1;
  sectionStarts = [0];
  listEl.innerHTML = "";

  if (tabs.length === 0) {
    items = [];
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader(title, hint);
    return;
  }

  // Build render order: group split siblings together
  const rendered = new Set();
  const orderedItems = [];
  let slotIndex = 1; // tracks the 1-9 keybinding slot

  for (let i = 0; i < tabs.length; i++) {
    if (rendered.has(i)) continue;

    const tab = tabs[i];
    const badge = slotIndex <= 9 ? String(slotIndex) : null;

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
          badgeEl.innerHTML = renderBadge(badge);
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
  updateHeader(title, hint);
}

function createTabElement(tab, badge) {
  const el = document.createElement("div");
  el.className = "list-item" + (tab.pending ? " tab-pending" : "");
  el.dataset.domId = tab.domId;

  let domain = "";
  try {
    domain = new URL(tab.url).hostname;
  } catch (e) {}

  // Unwrap moz-remote-image:// and filter chrome:// URLs
  let favicon = tab.favIconUrl || "";
  if (favicon.startsWith("moz-remote-image://")) {
    try { favicon = new URL(favicon).searchParams.get("url") || ""; } catch (e) { favicon = ""; }
  }
  const canLoadFavicon = favicon && !favicon.startsWith("chrome://");

  let wsHtml = "";
  if (tab.workspaceId && tab.workspaceId !== activeWorkspaceId) {
    const ws = workspaceMap[tab.workspaceId];
    if (ws) {
      const wsIcon = ws.svgContent
        ? `<span class="row-ws-icon">${ws.svgContent}</span>`
        : "";
      wsHtml = `<span class="row-workspace">${wsIcon}${escapeHtml(ws.name)}</span>`;
    }
  }

  const subtitleHtml = domain
    ? `<span class="item-subtitle"><span class="subtitle-domain">${escapeHtml(domain)}</span></span>`
    : "";

  const badgeHtml = badge !== null
    ? renderBadge(badge)
    : `<span class="item-badge-placeholder"></span>`;

  el.innerHTML = `
    ${canLoadFavicon
      ? `<img class="item-icon" src="${escapeAttr(favicon)}">`
      : `<span class="item-icon-placeholder">○</span>`}
    <span class="item-text">
      <span class="item-title">${escapeHtml(tab.title || "Untitled")}</span>
      ${subtitleHtml}
    </span>
    <span class="item-right">${wsHtml}${badgeHtml}</span>
  `;

  // Attach error handler via JS instead of inline onerror (CSP blocks inline handlers)
  const img = el.querySelector("img.item-icon");
  if (img) {
    img.addEventListener("error", () => { img.style.display = "none"; });
  }

  el.addEventListener("click", () => activateTab(tab.domId));
  el.addEventListener("mouseenter", () => {
    ext.runtime.sendMessage({ type: "preview-tab", domId: tab.domId }).catch(() => {});
  });
  el.addEventListener("mouseleave", () => {
    ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  });
  return el;
}

function createDuplicateTabElement(tab) {
  const el = document.createElement("div");
  el.className = "list-item duplicate-item" + (tab.pending ? " tab-pending" : "");
  el.dataset.domId = tab.domId;

  let domain = "";
  try { domain = new URL(tab.url).hostname; } catch (e) {}

  let dupFavicon = tab.favIconUrl || "";
  if (dupFavicon.startsWith("moz-remote-image://")) {
    try { dupFavicon = new URL(dupFavicon).searchParams.get("url") || ""; } catch (e) { dupFavicon = ""; }
  }
  const canLoadFavicon = dupFavicon && !dupFavicon.startsWith("chrome://");

  let wsHtml = "";
  if (tab.workspaceId && tab.workspaceId !== activeWorkspaceId) {
    const ws = workspaceMap[tab.workspaceId];
    if (ws) {
      const wsIcon = ws.svgContent
        ? `<span class="row-ws-icon">${ws.svgContent}</span>`
        : "";
      wsHtml = `<span class="row-workspace">${wsIcon}${escapeHtml(ws.name)}</span>`;
    }
  }

  const subtitleHtml = domain
    ? `<span class="item-subtitle"><span class="subtitle-domain">${escapeHtml(domain)}</span></span>`
    : "";

  el.innerHTML = `
    ${canLoadFavicon
      ? `<img class="item-icon" src="${escapeAttr(dupFavicon)}">`
      : `<span class="item-icon-placeholder">○</span>`}
    <span class="item-text">
      <span class="item-title">${escapeHtml(tab.title || "Untitled")}</span>
      ${subtitleHtml}
    </span>
    <span class="item-right">
      ${wsHtml}
      <span class="duplicate-close" title="Close tab">✕</span>
    </span>
  `;

  const img = el.querySelector("img.item-icon");
  if (img) {
    img.addEventListener("error", () => { img.style.display = "none"; });
  }

  el.querySelector(".duplicate-close").addEventListener("click", (e) => {
    e.stopPropagation();
    ext.runtime.sendMessage({ type: "close-tab", domId: tab.domId }).catch(() => {});
    el.remove();
  });

  el.addEventListener("click", () => activateTab(tab.domId));

  el.addEventListener("mouseenter", () => {
    ext.runtime.sendMessage({ type: "preview-tab", domId: tab.domId }).catch(() => {});
  });

  el.addEventListener("mouseleave", () => {
    ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  });

  return el;
}

function updateHeader(title, hint) {
  if (!title) {
    headerEl.classList.add("hidden");
    backButton.classList.add("hidden");
    viewTitle.textContent = "";
    headerHint.classList.add("hidden");
    return;
  }

  headerEl.classList.remove("hidden");
  backButton.classList.remove("hidden");
  viewTitle.textContent = title;

  headerHint.innerHTML = "";
  if (hint) {
    if (typeof hint === "string") {
      headerHint.innerHTML = hint;
    } else if (Array.isArray(hint)) {
      for (const h of hint) {
        const el = document.createElement("span");
        el.className = "header-hint-item";
        el.innerHTML = `<span class="header-hint-badge">${h.key}</span> ${escapeHtml(h.label)}`;
        if (h.onClick) el.addEventListener("click", h.onClick);
        headerHint.appendChild(el);
      }
    }
    headerHint.classList.remove("hidden");
  } else {
    headerHint.classList.add("hidden");
  }
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

  if (selectedIndex >= 0) {
    const item = items[selectedIndex];
    const isTabView = currentView !== "actions" && currentView !== "move-to-workspace" && currentView !== "close-and-select" && currentView !== "reorder-tabs";
    if (isTabView && item?.domId) {
      ext.runtime.sendMessage({ type: "preview-tab", domId: item.domId }).catch(() => {});
    } else if ((currentView === "actions" || currentView === "close-and-select") && item?.preview?.domId) {
      ext.runtime.sendMessage({ type: "preview-tab", domId: item.preview.domId }).catch(() => {});
    } else if (currentView === "actions" || currentView === "close-and-select") {
      ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
    }
  } else if (currentView === "actions" || currentView === "close-and-select") {
    ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  }
}

function filterByWorkspace(tabs) {
  if (workspaceFilter === "all") return tabs;
  return tabs.filter((t) => t.workspaceId === workspaceFilter);
}

function renderSidebar(sortOptions) {
  sidebarEl.innerHTML = "";

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
  allEl.className = "sidebar-item" + (workspaceFilter === "all" ? " active" : "");
  allEl.innerHTML = `<span class="sidebar-ws-name">All</span> ${renderBadge("0")}`;
  allEl.addEventListener("click", () => {
    workspaceFilter = workspaceFilter === "all" ? activeWorkspaceId : "all";
    refreshCurrentView();
  });
  sidebarEl.appendChild(allEl);

  const allWorkspaces = Object.entries(workspaceMap);
  for (let i = 0; i < allWorkspaces.length; i++) {
    const [uuid, ws] = allWorkspaces[i];
    const badge = i < 9 ? "⇧" + (i + 1) : null;
    const isActive = workspaceFilter === uuid;

    const el = document.createElement("div");
    el.className = "sidebar-item" + (isActive ? " active" : "");

    const iconHtml = ws.svgContent
      ? `<span class="sidebar-ws-icon">${ws.svgContent}</span>`
      : "";
    el.innerHTML = `${iconHtml}<span class="sidebar-ws-name">${escapeHtml(ws.name)}</span>${renderBadge(badge)}`;

    el.addEventListener("click", () => {
      workspaceFilter = workspaceFilter === uuid ? "all" : uuid;
      refreshCurrentView();
    });

    sidebarEl.appendChild(el);
  }

  sidebarEl.classList.remove("hidden");
}

function hideSidebar() {
  sidebarEl.classList.add("hidden");
  sidebarEl.innerHTML = "";
  sidebarFocused = false;
  sidebarSelectedIndex = -1;
}

function refreshCurrentView() {
  ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  switch (currentView) {
    case "last-visited": showLastVisited(false); break;
    case "recently-closed": showRecentlyClosed(false); break;
    case "child-tabs": showChildTabs(false); break;
    case "sibling-tabs": showSiblingTabs(false); break;
    case "parent-tabs": showParentTabs(false); break;
    case "unvisited": showUnvisitedTabs(false); break;
    case "duplicates": showDuplicates(false); break;
    case "domains": showDomains(false); break;
    case "domain-tabs": showDomainTabs(currentDomain, false); break;
    case "tabs-by-age": showTabsByAge(false); break;
    case "most-visited": showMostVisited(false); break;
  }
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

function jumpToSection(delta) {
  const count = items.length;
  if (count === 0) return;
  const hasSidebar = !sidebarEl.classList.contains("hidden");

  // Single section (submenus): Tab between list and sidebar
  if (sectionStarts.length <= 1) {
    if (hasSidebar) {
      if (!sidebarFocused) {
        sidebarFocused = true;
        sidebarSelectedIndex = delta > 0 ? 0 : sidebarEl.querySelectorAll(".sidebar-item, .sidebar-sort").length - 1;
        selectedIndex = -1;
        updateSelection();
        updateSidebarSelection();
        return;
      } else {
        sidebarFocused = false;
        sidebarSelectedIndex = -1;
        selectedIndex = delta > 0 ? 0 : count - 1;
        updateSidebarSelection();
        updateSelection();
        return;
      }
    }
    selectedIndex = delta > 0 ? 0 : count - 1;
    updateSelection();
    return;
  }

  // Find which section current selection is in
  let currentSection = 0;
  for (let i = sectionStarts.length - 1; i >= 0; i--) {
    if (selectedIndex >= sectionStarts[i]) {
      currentSection = i;
      break;
    }
  }

  // Move to next/previous section
  let targetSection = currentSection + delta;
  if (targetSection < 0) targetSection = sectionStarts.length - 1;
  if (targetSection >= sectionStarts.length) targetSection = 0;

  selectedIndex = sectionStarts[targetSection];

  // Skip disabled items forward
  const listItems = listEl.querySelectorAll(".list-item");
  const startIndex = selectedIndex;
  while (listItems[selectedIndex]?.classList.contains("disabled")) {
    selectedIndex = (selectedIndex + 1) % count;
    if (selectedIndex === startIndex) break;
  }

  updateSelection();
}

function updateSidebarSelection() {
  const sidebarItems = sidebarEl.querySelectorAll(".sidebar-item, .sidebar-sort");
  sidebarItems.forEach((el, i) => {
    el.classList.toggle("focused", sidebarFocused && i === sidebarSelectedIndex);
  });
}

function moveSidebarSelection(delta) {
  const sidebarItems = sidebarEl.querySelectorAll(".sidebar-item, .sidebar-sort");
  const count = sidebarItems.length;
  if (count === 0) return;
  if (sidebarSelectedIndex === -1) {
    sidebarSelectedIndex = delta > 0 ? 0 : count - 1;
  } else {
    sidebarSelectedIndex = (sidebarSelectedIndex + delta + count) % count;
  }
  updateSidebarSelection();
}

function activateSidebarSelected() {
  const sidebarItems = sidebarEl.querySelectorAll(".sidebar-item, .sidebar-sort");
  if (sidebarSelectedIndex >= 0 && sidebarSelectedIndex < sidebarItems.length) {
    sidebarItems[sidebarSelectedIndex].click();
  }
}

function activateSelected() {
  if (selectedIndex < 0 || items.length === 0) return;

  const item = items[selectedIndex];
  const listItems = listEl.querySelectorAll(".list-item");
  if (listItems[selectedIndex]?.classList.contains("disabled")) return;

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
// Views
// ---------------------------------------------------------------------------

async function fetchWorkspaceMap() {
  try {
    const workspaces = await ext.runtime.sendMessage({ type: "get-workspaces-with-icons" });
    workspaceMap = {};
    activeWorkspaceId = null;
    for (const ws of workspaces) {
      workspaceMap[ws.uuid] = { name: ws.name, svgContent: ws.svgContent };
      if (ws.isActive) activeWorkspaceId = ws.uuid;
    }
  } catch (e) {
    workspaceMap = {};
    activeWorkspaceId = null;
  }
}

async function showActionsMenu() {
  currentView = "actions";

  // Fetch tab info for disabling unavailable actions and previews
  try {
    const allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
    const activeTab = allTabs.find((t) => t.active);
    currentTabHasParent = !!(activeTab && activeTab.openerTabDomId);
    childTabCount = activeTab ? allTabs.filter((t) => t.openerTabDomId === activeTab.domId).length : 0;
    siblingTabCount = (activeTab && activeTab.openerTabDomId)
      ? allTabs.filter((t) => t.openerTabDomId === activeTab.openerTabDomId && t.domId !== activeTab.domId).length
      : 0;
    unvisitedTabCount = allTabs.filter((t) => t.unread).length;
    const childOpeners = new Set(allTabs.filter((t) => t.openerTabDomId).map((t) => t.openerTabDomId));
    parentTabCount = allTabs.filter((t) => childOpeners.has(t.domId)).length;
    const domainSet = new Set();
    for (const t of allTabs) { try { domainSet.add(new URL(t.url).hostname); } catch (e) {} }
    domainSet.delete("");
    domainCount = domainSet.size;

    // Workspace tab counts
    workspaceTabCounts = {};
    for (const t of allTabs) {
      if (t.workspaceId) workspaceTabCounts[t.workspaceId] = (workspaceTabCounts[t.workspaceId] || 0) + 1;
    }

    // Duplicate groups count
    const urlCounts = {};
    for (const t of allTabs) {
      if (t.url && t.url !== "about:newtab" && t.url !== "about:blank") {
        urlCounts[t.url] = (urlCounts[t.url] || 0) + 1;
      }
    }
    duplicateGroupCount = Object.values(urlCounts).filter((c) => c > 1).length;

    try {
      const closed = await ext.runtime.sendMessage({ type: "get-recently-closed" });
      recentlyClosedCount = Array.isArray(closed) ? closed.length : 0;
    } catch (e) {
      recentlyClosedCount = 0;
    }

    // Parent tab preview
    if (currentTabHasParent) {
      const parent = allTabs.find((t) => t.domId === activeTab.openerTabDomId);
      parentTabPreview = parent ? { title: parent.title, favIconUrl: parent.favIconUrl, domId: parent.domId, workspaceId: parent.workspaceId, pending: parent.pending } : null;
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
      ? { title: candidates[0].title, favIconUrl: candidates[0].favIconUrl, domId: candidates[0].domId, workspaceId: candidates[0].workspaceId, pending: candidates[0].pending }
      : null;

    // Fetch selected tab count and workspace map in parallel
    try {
      const [selectedDomIds] = await Promise.all([
        ext.runtime.sendMessage({ type: "get-selected-tab-dom-ids" }),
        fetchWorkspaceMap(),
      ]);
      selectedTabCount = selectedDomIds.length;
    } catch (e) {
      selectedTabCount = 0;
    }
  } catch (e) {
    currentTabHasParent = false;
    childTabCount = 0;
    siblingTabCount = 0;
    parentTabCount = 0;
    domainCount = 0;
    unvisitedTabCount = 0;
    duplicateGroupCount = 0;
    recentlyClosedCount = 0;
    parentTabPreview = null;
    previousTabPreview = null;
    selectedTabCount = 0;
  }

  if (!initialView) {
    renderActions(getActions(), null);
    hideSidebar();
  }
}

async function showChildTabs(animate) {
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

  const children = filterByWorkspace(allTabs.filter((t) => t.openerTabDomId === activeTab.domId));
  renderTabList(children, "Children");
  renderSidebar();
}

async function showSiblingTabs(animate) {
  currentView = "sibling-tabs";

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    renderTabList([], "Siblings");
    return;
  }

  const activeTab = allTabs.find((t) => t.active);
  if (!activeTab || !activeTab.openerTabDomId) {
    renderTabList([], "Siblings");
    return;
  }

  const siblings = filterByWorkspace(allTabs.filter((t) => t.openerTabDomId === activeTab.openerTabDomId && t.domId !== activeTab.domId));
  renderTabList(siblings, "Siblings");
  renderSidebar();
}

async function showParentTabs(animate) {
  currentView = "parent-tabs";

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    renderTabList([], "Parent tabs");
    return;
  }

  const childOpeners = new Set(allTabs.filter((t) => t.openerTabDomId).map((t) => t.openerTabDomId));
  const parents = filterByWorkspace(allTabs.filter((t) => childOpeners.has(t.domId)));
  renderTabList(parents, "Parent tabs");
  renderSidebar();
}

async function showNavigation() {
  currentView = "navigation";
  items = [];
  selectedIndex = -1;
  sectionStarts = [0];

  let history;
  try {
    history = await ext.runtime.sendMessage({ type: "get-navigation-history" });
  } catch (e) {}

  if (!history || !history.entries || history.entries.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No navigation history</div>`;
    updateHeader("Tab history");
    return;
  }

  listEl.innerHTML = "";
  const currentIndex = history.index;
  let itemNum = 1;

  for (let i = 0; i < history.entries.length; i++) {
    const entry = history.entries[i];
    const isCurrent = i === currentIndex;

    let domain = "";
    try { domain = new URL(entry.url).hostname; } catch (e) {}

    const el = document.createElement("div");
    el.className = "list-item" + (isCurrent ? " nav-current" : "");

    let badge = null;
    let extraBadge = "";
    if (!isCurrent) {
      if (itemNum <= 9) { badge = String(itemNum); itemNum++; }
    }
    if (i === currentIndex - 1) extraBadge = renderBadge("B");
    if (i === currentIndex + 1) extraBadge = renderBadge("F");

    const label = i < currentIndex ? "← " : i > currentIndex ? "→ " : "● ";

    el.innerHTML = `
      <span class="item-icon-placeholder nav-direction">${label}</span>
      <span class="item-text">
        <span class="item-title">${escapeHtml(entry.title || entry.url || "Untitled")}</span>
        ${domain ? `<span class="item-subtitle">${escapeHtml(domain)}</span>` : ""}
      </span>
      <span class="item-right">
        ${extraBadge}
        ${renderBadge(badge)}
      </span>
    `;

    if (!isCurrent) {
      const navIndex = i;
      el.addEventListener("click", () => {
        ext.runtime.sendMessage({ type: "navigate-to-history-index", index: navIndex }).catch(() => {});
      });
    }

    items.push({ navIndex: i, isCurrent });
    listEl.appendChild(el);
  }

  // Pre-select the current item
  selectedIndex = currentIndex;
  updateSelection();
  updateHeader("Tab history");
}

async function showUnvisitedTabs(animate) {
  currentView = "unvisited";

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    renderTabList([], "New tabs");
    return;
  }

  const unvisited = filterByWorkspace(allTabs.filter((t) => t.unread));
  renderTabList(unvisited, "New tabs");
  renderSidebar();
}

async function showLastVisited(animate) {
  currentView = "last-visited";

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    renderTabList([], "Recent");
    return;
  }

  allTabs.sort((a, b) => b.lastAccessed - a.lastAccessed);

  const activeTab = allTabs.find((t) => t.active);
  const activeSplitGroupId = activeTab?.splitGroupId;

  const filtered = filterByWorkspace(allTabs.filter((t) => {
    if (t.active) return false;
    if (activeSplitGroupId && t.splitGroupId === activeSplitGroupId) return false;
    if (!t.url || t.url === "about:newtab" || t.url === "about:blank") return false;
    return true;
  }));

  renderTabList(filtered, "Recent");
  renderSidebar();
}

async function showRecentlyClosed(animate) {
  currentView = "recently-closed";
  selectedIndex = -1;
  sectionStarts = [0];
  hideSidebar();

  let entries;
  try {
    entries = await ext.runtime.sendMessage({ type: "get-recently-closed" });
  } catch (e) { entries = []; }

  if (!entries || entries.length === 0) {
    items = [];
    listEl.innerHTML = `<div class="empty-state">No recently closed tabs</div>`;
    updateHeader("Recently closed");
    return;
  }

  renderRecentlyClosedList(entries);
  updateHeader("Recently closed");
}

function renderRecentlyClosedList(entries) {
  listEl.innerHTML = "";
  items = [];

  let slotIndex = 1;
  for (const entry of entries) {
    const badge = slotIndex <= 9 ? String(slotIndex) : null;

    let domain = "";
    try { domain = new URL(entry.url).hostname; } catch (e) {}

    let favicon = entry.favIconUrl || "";
    if (favicon.startsWith("moz-remote-image://")) {
      try { favicon = new URL(favicon).searchParams.get("url") || ""; } catch (e) { favicon = ""; }
    }
    const canLoadFavicon = favicon && !favicon.startsWith("chrome://");

    const el = document.createElement("div");
    el.className = "list-item";
    el.dataset.sessionId = entry.sessionId;
    el.innerHTML = `
      ${canLoadFavicon
        ? `<img class="item-icon" src="${escapeAttr(favicon)}">`
        : `<span class="item-icon-placeholder">○</span>`}
      <span class="item-text">
        <span class="item-title">${escapeHtml(entry.title || entry.url || "Untitled")}</span>
        ${domain ? `<span class="item-subtitle"><span class="subtitle-domain">${escapeHtml(domain)}</span></span>` : ""}
      </span>
      <span class="item-right">${badge !== null
        ? renderBadge(badge)
        : `<span class="item-badge-placeholder"></span>`}</span>
    `;

    const img = el.querySelector("img.item-icon");
    if (img) img.addEventListener("error", () => { img.style.display = "none"; });

    const sessionId = entry.sessionId;
    el.addEventListener("click", () => {
      ext.runtime.sendMessage({ type: "restore-closed-tab", sessionId }).catch(() => {});
    });

    items.push({ sessionId });
    listEl.appendChild(el);
    slotIndex++;
  }

  updateSelection();
}

async function showMoveToWorkspace() {
  currentView = "move-to-workspace";
  let workspaces;
  try {
    workspaces = await ext.runtime.sendMessage({ type: "get-workspaces-with-icons" });
  } catch (e) { workspaces = []; }
  const otherWorkspaces = workspaces.filter(ws => !ws.isActive);
  renderWorkspaceList(otherWorkspaces, "Move to workspace");
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
    const badge = (i + 1) <= 9 ? String(i + 1) : null;

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
      ${badge !== null ? `<span class="item-right">${renderBadge(badge)}</span>` : ""}
    `;

    el.addEventListener("click", () => moveToWorkspace(ws.uuid));
    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader(title);
}

function formatDuration(ms) {
  if (ms < 0) return "unknown";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatBytes(bytes) {
  if (bytes == null) return "N/A";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function showTabInfo() {
  currentView = "tab-info";
  items = [];
  selectedIndex = -1;

  let allTabs, info;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
    const activeTab = allTabs.find((t) => t.active);
    if (!activeTab) { renderTabInfo(null); return; }
    info = await ext.runtime.sendMessage({ type: "get-tab-info", domId: activeTab.domId });
  } catch (e) {
    renderTabInfo(null);
    return;
  }
  if (!info) { renderTabInfo(null); return; }

  // Gather visits for all unique URLs in session history + current URL
  const urlSet = new Set();
  if (info.url && !info.url.startsWith("about:")) urlSet.add(info.url);
  for (const entry of info.sessionEntries) {
    if (entry.url && !entry.url.startsWith("about:")) urlSet.add(entry.url);
  }

  const titleByUrl = {};
  for (const entry of info.sessionEntries) {
    if (!titleByUrl[entry.url]) titleByUrl[entry.url] = entry.title;
  }
  if (!titleByUrl[info.url]) titleByUrl[info.url] = info.title;

  let allVisits = [];
  try {
    const results = await Promise.all(
      [...urlSet].map((url) => ext.runtime.sendMessage({ type: "get-history-visits", url }).then(
        (visits) => visits.map((v) => ({ ...v, url, title: titleByUrl[url] || url })),
        () => []
      ))
    );
    allVisits = results.flat();
  } catch (e) {}

  const duplicates = allTabs.filter((t) => info.duplicateDomIds.includes(t.domId));
  renderTabInfo(info, allVisits, duplicates);
}

function formatTransition(t) {
  const map = {
    link: "link",
    typed: "typed",
    auto_bookmark: "bookmark",
    auto_subframe: "frame",
    manual_subframe: "frame",
    generated: "generated",
    auto_toplevel: "auto",
    form_submit: "form",
    reload: "reload",
    keyword: "search",
    keyword_generated: "search",
  };
  return map[t] || t || "";
}

function groupVisitsByDate(visits) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const dayFmt = { weekday: "long", month: "long", day: "numeric" };
  const groups = [];
  const map = new Map();

  for (const visit of visits) {
    const d = new Date(visit.visitTime);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let key, label;
    if (day >= today) {
      key = "today";
      label = "Today";
    } else if (day >= yesterday) {
      key = "yesterday";
      label = "Yesterday";
    } else if (day >= thisMonthStart) {
      const daysAgo = Math.round((today - day) / (1000 * 60 * 60 * 24));
      if (daysAgo <= 6) {
        key = `${daysAgo}-days-ago`;
        label = `${daysAgo} days ago`;
      } else {
        const weeksAgo = Math.round(daysAgo / 7);
        key = `${weeksAgo}-weeks-ago`;
        label = weeksAgo === 1 ? "1 week ago" : `${weeksAgo} weeks ago`;
      }
    } else {
      key = `${d.getFullYear()}-${d.getMonth()}`;
      label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    if (!map.has(key)) {
      const group = { label, visits: [], subgroups: null };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).visits.push(visit);
  }

  // Build day subgroups for all groups
  for (const group of groups) {
    const dayMap = new Map();
    group.subgroups = [];
    for (const visit of group.visits) {
      const d = new Date(visit.visitTime);
      const dayKey = d.toISOString().slice(0, 10);
      if (!dayMap.has(dayKey)) {
        const sub = { label: d.toLocaleDateString(undefined, dayFmt), visits: [] };
        dayMap.set(dayKey, sub);
        group.subgroups.push(sub);
      }
      dayMap.get(dayKey).visits.push(visit);
    }
  }

  return groups;
}

function renderVisitRows(visits) {
  let html = `<div class="info-history-table">`;
  for (const visit of visits) {
    const d = new Date(visit.visitTime);
    const datePart = d.toLocaleDateString([], { month: "short", day: "numeric" });
    const timePart = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const transition = formatTransition(visit.transition);
    html += `<div class="info-history-row">`;
    html += `<span class="info-history-date">${datePart}</span>`;
    html += `<span class="info-history-time">${timePart}</span>`;
    html += `<span class="info-history-event">${escapeHtml(transition)}</span>`;
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
}

function renderTabInfo(info, visits, duplicates) {
  listEl.innerHTML = "";

  if (!info) {
    listEl.innerHTML = `<div class="empty-state">No tab info available</div>`;
    updateHeader("Tab info");
    return;
  }

  const now = Date.now();

  let domain = "";
  try { domain = new URL(info.url).hostname; } catch (e) {}

  let infoFavicon = info.favIconUrl || "";
  if (infoFavicon.startsWith("moz-remote-image://")) {
    try { infoFavicon = new URL(infoFavicon).searchParams.get("url") || ""; } catch (e) { infoFavicon = ""; }
  }
  const canLoadFavicon = infoFavicon && !infoFavicon.startsWith("chrome://");
  const faviconHtml = canLoadFavicon
    ? `<img class="info-favicon" src="${escapeAttr(infoFavicon)}">`
    : `<span class="info-favicon-placeholder">○</span>`;

  let html = "";

  // Header
  html += `<div class="info-header">
    ${faviconHtml}
    <div class="info-header-text">
      <div class="info-header-title">${escapeHtml(info.title || "Untitled")}</div>
      <div class="info-header-url">${escapeHtml(domain)}</div>
    </div>
  </div>`;

  // Stats grid (two columns)
  html += `<div class="info-grid">`;

  // Tab age from domId timestamp
  const createdTs = parseInt(info.domId.split("-")[0]);
  if (createdTs > 1e12) {
    html += `<div class="info-cell"><span class="info-label">Tab age</span><span class="info-value">${formatDuration(now - createdTs)}</span></div>`;
  }

  if (visits && visits.length > 0) {
    const firstVisit = Math.min(...visits.map((v) => v.visitTime));
    html += `<div class="info-cell"><span class="info-label">First visited</span><span class="info-value">${formatDuration(now - firstVisit)} ago</span></div>`;
  }

  html += `<div class="info-cell"><span class="info-label">Memory</span><span class="info-value">${formatBytes(info.memory)}</span></div>`;

  if (info.cpuTime != null) {
    html += `<div class="info-cell"><span class="info-label">CPU time</span><span class="info-value">${(info.cpuTime / 1e6).toFixed(0)} ms</span></div>`;
  }

  if (visits && visits.length > 0) {
    html += `<div class="info-cell"><span class="info-label">Total visits</span><span class="info-value">${visits.length}</span></div>`;
  }

  if (duplicates && duplicates.length > 1) {
    html += `<div class="info-cell"><span class="info-label">Duplicates</span><span class="info-value">${duplicates.length}</span></div>`;
  }

  html += `</div>`;

  // Duplicates (before history) — includes self
  if (duplicates && duplicates.length > 1) {
    html += `<div class="info-section info-duplicates-section">`;
    html += `<div class="info-section-header"><span class="info-section-title">Duplicate tabs (${duplicates.length})</span> <span class="info-close-others">Close others</span></div>`;
    html += `<div class="info-duplicates-grid">`;
    for (let i = 0; i < duplicates.length; i++) {
      const dup = duplicates[i];
      const isSelf = dup.domId === info.domId;
      const dupAge = formatDuration(now - parseInt(dup.domId.split("-")[0]));
      const ws = dup.workspaceId ? workspaceMap[dup.workspaceId] : null;
      const wsIcon = ws?.svgContent ? `<span class="dup-ws-icon">${ws.svgContent}</span>` : "";
      const wsName = ws ? escapeHtml(ws.name) : "";
      const wsNote = isSelf ? `<span class="dup-ws-note">(this tab)</span>`
        : (dup.workspaceId === activeWorkspaceId) ? `<span class="dup-ws-note">(this workspace)</span>` : "";
      html += `<div class="info-duplicate-row${isSelf ? " dup-self" : ""}" data-dom-id="${escapeAttr(dup.domId)}">`;
      html += `<span class="dup-index">${i + 1}</span>`;
      html += `<span class="dup-workspace">${wsIcon}${wsName}${wsNote}</span>`;
      html += `<span class="dup-age">open for ${dupAge}</span>`;
      if (!isSelf) {
        html += `<span class="dup-close" title="Close tab">✕</span>`;
      } else {
        html += `<span></span>`;
      }
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  // Combined visit history grouped by date
  if (visits && visits.length > 0) {
    const sorted = [...visits].sort((a, b) => b.visitTime - a.visitTime);
    const groups = groupVisitsByDate(sorted);
    html += `<div class="info-section">`;
    html += `<div class="info-section-title">History</div>`;
    for (const group of groups) {
      html += `<details class="info-date-details" open>`;
      html += `<summary class="info-date-group">${escapeHtml(group.label)}</summary>`;
      for (const sub of group.subgroups) {
        html += `<details class="info-date-details info-date-sub" open>`;
        html += `<summary class="info-date-subgroup">${escapeHtml(sub.label)}</summary>`;
        html += renderVisitRows(sub.visits);
        html += `</details>`;
      }
      html += `</details>`;
    }
    html += `</div>`;
  }

  listEl.innerHTML = html;

  // Wire up duplicate row interactions
  if (duplicates && duplicates.length > 1) {
    for (const row of listEl.querySelectorAll(".info-duplicate-row:not(.dup-self)")) {
      const domId = row.dataset.domId;
      row.addEventListener("click", (e) => {
        if (e.target.classList.contains("dup-close")) return;
        activateTab(domId);
      });
      row.querySelector(".dup-close").addEventListener("click", (e) => {
        e.stopPropagation();
        ext.runtime.sendMessage({ type: "close-tab", domId }).catch(() => {});
        row.remove();
      });
      row.addEventListener("mouseenter", () => {
        ext.runtime.sendMessage({ type: "preview-tab", domId }).catch(() => {});
      });
      row.addEventListener("mouseleave", () => {
        ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
      });
    }
    const closeOthers = listEl.querySelector(".info-close-others");
    if (closeOthers) {
      closeOthers.addEventListener("click", () => {
        for (const dup of duplicates) {
          if (dup.domId === info.domId) continue;
          ext.runtime.sendMessage({ type: "close-tab", domId: dup.domId }).catch(() => {});
        }
        listEl.querySelectorAll(".info-duplicate-row:not(.dup-self)").forEach((r) => r.remove());
        closeOthers.remove();
      });
    }
  }

  const img = listEl.querySelector("img.info-favicon");
  if (img) {
    img.addEventListener("error", () => { img.style.display = "none"; });
  }

  updateHeader("Tab info");
}

async function showDuplicates(animate) {
  currentView = "duplicates";
  items = [];
  selectedIndex = -1;

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">No duplicates</div>`;
    updateHeader("Duplicates");
    return;
  }

  const filtered = filterByWorkspace(allTabs);

  // Group tabs by URL
  const urlGroups = {};
  for (const tab of filtered) {
    if (!tab.url || tab.url === "about:newtab" || tab.url === "about:blank") continue;
    if (!urlGroups[tab.url]) urlGroups[tab.url] = [];
    urlGroups[tab.url].push(tab);
  }

  // Filter to only groups with duplicates, sort by group size descending
  const groups = Object.values(urlGroups)
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length);

  if (groups.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No duplicates</div>`;
    updateHeader("Duplicates");
    return;
  }

  renderDuplicateGroups(groups);
  renderSidebar();
}

function renderDuplicateGroups(groups) {
  sectionStarts = [0];
  const now = Date.now();
  let html = "";

  for (const group of groups) {
    const sample = group[0];
    let domain = "";
    try { domain = new URL(sample.url).hostname; } catch (e) {}

    let favicon = sample.favIconUrl || "";
    if (favicon.startsWith("moz-remote-image://")) {
      try { favicon = new URL(favicon).searchParams.get("url") || ""; } catch (e) { favicon = ""; }
    }
    const canLoadFavicon = favicon && !favicon.startsWith("chrome://");

    html += `<div class="dup-group">`;
    html += `<div class="dup-group-header">`;
    html += canLoadFavicon
      ? `<img class="dup-group-favicon" src="${escapeAttr(favicon)}">`
      : `<span class="dup-group-favicon-placeholder">○</span>`;
    html += `<div class="dup-group-text">`;
    html += `<div class="dup-group-title">${escapeHtml(sample.title || "Untitled")}<span class="item-count">${group.length}</span></div>`;
    if (domain) html += `<div class="dup-group-domain">${escapeHtml(domain)}</div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="info-duplicates-grid">`;
    for (let i = 0; i < group.length; i++) {
      const tab = group[i];
      const age = formatDuration(now - parseInt(tab.domId.split("-")[0]));
      const ws = tab.workspaceId ? workspaceMap[tab.workspaceId] : null;
      const wsIcon = ws?.svgContent ? `<span class="dup-ws-icon">${ws.svgContent}</span>` : "";
      const wsName = ws ? escapeHtml(ws.name) : "";
      const isActive = tab.active;
      const wsNote = isActive ? `<span class="dup-ws-note">(this tab)</span>`
        : (tab.workspaceId === activeWorkspaceId) ? `<span class="dup-ws-note">(this workspace)</span>` : "";
      html += `<div class="info-duplicate-row${isActive ? " dup-self" : ""}${tab.pending ? " tab-pending" : ""}" data-dom-id="${escapeAttr(tab.domId)}">`;
      html += `<span class="dup-index">${i + 1}</span>`;
      html += `<span class="dup-workspace">${wsIcon}${wsName}${wsNote}</span>`;
      html += `<span class="dup-age">open for ${age}</span>`;
      if (!isActive) {
        html += `<span class="dup-close" title="Close tab">✕</span>`;
      } else {
        html += `<span></span>`;
      }
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  listEl.innerHTML = html;

  // Wire up interactions
  for (const row of listEl.querySelectorAll(".info-duplicate-row:not(.dup-self)")) {
    const domId = row.dataset.domId;
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("dup-close")) return;
      activateTab(domId);
    });
    row.querySelector(".dup-close").addEventListener("click", (e) => {
      e.stopPropagation();
      ext.runtime.sendMessage({ type: "close-tab", domId }).catch(() => {});
      row.remove();
    });
    row.addEventListener("mouseenter", () => {
      ext.runtime.sendMessage({ type: "preview-tab", domId }).catch(() => {});
    });
    row.addEventListener("mouseleave", () => {
      ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
    });
  }

  // Handle favicon errors
  for (const img of listEl.querySelectorAll("img.dup-group-favicon")) {
    img.addEventListener("error", () => { img.style.display = "none"; });
  }

  updateHeader("Duplicates");
}

// ---------------------------------------------------------------------------
// Domains submenu
// ---------------------------------------------------------------------------

async function showDomains(animate) {
  currentView = "domains";
  items = [];
  selectedIndex = -1;

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader("Domains");
    return;
  }

  const wsFiltered = filterByWorkspace(allTabs);

  const domainMap = {};
  for (const tab of wsFiltered) {
    let hostname = "";
    try { hostname = new URL(tab.url).hostname; } catch (e) {}
    if (!hostname) continue;
    if (!domainMap[hostname]) domainMap[hostname] = { tabs: [], favicon: "" };
    domainMap[hostname].tabs.push(tab);
    if (!domainMap[hostname].favicon && tab.favIconUrl) {
      domainMap[hostname].favicon = tab.favIconUrl;
    }
  }

  const domains = Object.entries(domainMap)
    .map(([domain, data]) => ({ domain, count: data.tabs.length, favicon: data.favicon }))
    .sort(domainsSortAlpha
      ? (a, b) => a.domain.localeCompare(b.domain)
      : (a, b) => b.count - a.count);

  const sortOpts = [{ key: "S", label: "Sort by " + (domainsSortAlpha ? "count" : "A-Z"), onClick: () => { domainsSortAlpha = !domainsSortAlpha; refreshCurrentView(); } }];
  renderDomainList(domains, "Domains");
  renderSidebar(sortOpts);
}

function renderDomainList(domains, title) {
  selectedIndex = -1;
  sectionStarts = [0];
  listEl.innerHTML = "";

  if (domains.length === 0) {
    items = [];
    listEl.innerHTML = `<div class="empty-state">No domains</div>`;
    updateHeader(title);
    return;
  }

  items = domains;

  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    const badge = (i + 1) <= 9 ? String(i + 1) : null;

    const el = document.createElement("div");
    el.className = "list-item";
    el.dataset.domain = d.domain;

    let favicon = d.favicon || "";
    if (favicon.startsWith("moz-remote-image://")) {
      try { favicon = new URL(favicon).searchParams.get("url") || ""; } catch (e) { favicon = ""; }
    }
    const canLoad = favicon && !favicon.startsWith("chrome://");

    el.innerHTML = `
      ${canLoad
        ? `<img class="item-icon" src="${escapeAttr(favicon)}">`
        : `<span class="item-icon-placeholder">○</span>`}
      <span class="item-text">
        <span class="item-title">${escapeHtml(d.domain)}</span>
      </span>
      <span class="item-right">
        <span class="item-count">${d.count}</span>
        ${renderBadge(badge)}
        <span class="item-arrow">›</span>
      </span>
    `;

    const img = el.querySelector("img.item-icon");
    if (img) img.addEventListener("error", () => { img.style.display = "none"; });

    el.addEventListener("click", () => {
      navigateToView("domain-tabs", { domain: d.domain });
    });
    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader(title);
}

async function showDomainTabs(domain, animate) {
  currentView = "domain-tabs";
  currentDomain = domain;

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    renderTabList([], domain);
    return;
  }

  const filtered = allTabs.filter((t) => {
    try { return new URL(t.url).hostname === domain; } catch (e) { return false; }
  });

  const wsFiltered = filterByWorkspace(filtered);

  renderTabList(wsFiltered, domain);
  renderSidebar();
}

// ---------------------------------------------------------------------------
// Tabs by age submenu
// ---------------------------------------------------------------------------

function getAgeGroup(ageMs) {
  const hours = ageMs / (1000 * 60 * 60);
  const days = hours / 24;
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  if (days < 3) return "2-3 days";
  if (days < 7) return "This week";
  if (days < 14) return "1-2 weeks";
  if (days < 28) return "2-4 weeks";
  if (days < 90) return "1-3 months";
  if (days < 180) return "3-6 months";
  if (days < 365) return "6-12 months";
  return "Over a year";
}

async function showTabsByAge(animate) {
  currentView = "tabs-by-age";
  items = [];
  selectedIndex = -1;

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader("Tabs by age");
    return;
  }

  let filtered = filterByWorkspace(allTabs.filter((t) => t.url && t.url !== "about:newtab" && t.url !== "about:blank"));

  const now = Date.now();
  filtered.sort((a, b) => {
    const ageA = parseInt(a.domId.split("-")[0]) || now;
    const ageB = parseInt(b.domId.split("-")[0]) || now;
    return tabsByAgeNewestFirst ? ageB - ageA : ageA - ageB;
  });

  // Group by age
  const groups = [];
  const groupMap = new Map();
  for (const tab of filtered) {
    const created = parseInt(tab.domId.split("-")[0]) || now;
    const age = now - created;
    const label = getAgeGroup(age);
    if (!groupMap.has(label)) {
      const group = { label, tabs: [] };
      groupMap.set(label, group);
      groups.push(group);
    }
    groupMap.get(label).tabs.push(tab);
  }

  const sortOpts = [{ key: "S", label: "Sort by " + (tabsByAgeNewestFirst ? "oldest" : "newest"), onClick: () => { tabsByAgeNewestFirst = !tabsByAgeNewestFirst; refreshCurrentView(); } }];
  renderTabsByAge(groups);
  renderSidebar(sortOpts);
}

function renderTabsByAge(groups) {
  selectedIndex = -1;
  sectionStarts = [0];
  listEl.innerHTML = "";
  const allItems = [];

  if (groups.length === 0) {
    items = [];
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader("Tabs by age");
    return;
  }

  const now = Date.now();

  for (const group of groups) {
    const details = document.createElement("details");
    details.className = "info-date-details";
    details.open = true;

    const summary = document.createElement("summary");
    summary.className = "info-date-group";
    summary.textContent = `${group.label} (${group.tabs.length})`;
    details.appendChild(summary);

    const container = document.createElement("div");
    container.style.padding = "0 0 4px";

    for (const tab of group.tabs) {
      const created = parseInt(tab.domId.split("-")[0]) || now;
      const age = formatDuration(now - created);

      const el = document.createElement("div");
      el.className = "list-item age-tab-item" + (tab.pending ? " tab-pending" : "");
      el.dataset.domId = tab.domId;

      let domain = "";
      try { domain = new URL(tab.url).hostname; } catch (e) {}

      let favicon = tab.favIconUrl || "";
      if (favicon.startsWith("moz-remote-image://")) {
        try { favicon = new URL(favicon).searchParams.get("url") || ""; } catch (e) { favicon = ""; }
      }
      const canLoadFavicon = favicon && !favicon.startsWith("chrome://");

      let wsHtml = "";
      if (tab.workspaceId && tab.workspaceId !== activeWorkspaceId) {
        const ws = workspaceMap[tab.workspaceId];
        if (ws) {
          const wsIcon = ws.svgContent ? `<span class="row-ws-icon">${ws.svgContent}</span>` : "";
          wsHtml = `<span class="row-workspace">${wsIcon}${escapeHtml(ws.name)}</span>`;
        }
      }

      const subtitleParts = [
        domain ? `<span class="subtitle-domain">${escapeHtml(domain)}</span>` : "",
        `<span class="subtitle-age">${age}</span>`,
      ].filter(Boolean).join("");

      el.innerHTML = `
        ${canLoadFavicon
          ? `<img class="item-icon" src="${escapeAttr(favicon)}">`
          : `<span class="item-icon-placeholder">○</span>`}
        <span class="item-text">
          <span class="item-title">${escapeHtml(tab.title || "Untitled")}</span>
          <span class="item-subtitle">${subtitleParts}</span>
        </span>
        <span class="item-right">
          ${wsHtml}
          <span class="age-close" title="Close tab">✕</span>
        </span>
      `;

      const img = el.querySelector("img.item-icon");
      if (img) img.addEventListener("error", () => { img.style.display = "none"; });

      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("age-close")) return;
        activateTab(tab.domId);
      });

      el.querySelector(".age-close").addEventListener("click", (e) => {
        e.stopPropagation();
        ext.runtime.sendMessage({ type: "close-tab", domId: tab.domId }).catch(() => {});
        el.remove();
      });

      el.addEventListener("mouseenter", () => {
        ext.runtime.sendMessage({ type: "preview-tab", domId: tab.domId }).catch(() => {});
      });
      el.addEventListener("mouseleave", () => {
        ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
      });

      allItems.push(tab);
      container.appendChild(el);
    }

    details.appendChild(container);
    listEl.appendChild(details);
  }

  items = allItems;
  updateHeader("Tabs by age");
}

// ---------------------------------------------------------------------------
// Reorder tabs submenu
// ---------------------------------------------------------------------------

function showReorderTabs() {
  currentView = "reorder-tabs";
  sectionStarts = [0];

  const reorderOptions = kbChildrenOf("reorder-tabs").map((c) => ({
    label: c.label,
    hotkey: c.chord,
    icon: c.icon,
    reorderAction: c.id,
  }));

  items = reorderOptions;
  selectedIndex = -1;
  listEl.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "actions-grid actions-grid-2col";

  for (const opt of reorderOptions) {
    const el = document.createElement("div");
    el.className = "list-item compact-item";

    el.innerHTML = `
      <span class="item-icon-placeholder">${getIcon(opt.icon)}</span>
      <span class="item-text">
        <span class="item-title">${escapeHtml(opt.label)}</span>
      </span>
      <span class="item-right">
        ${renderBadge(displayKey(opt.hotkey))}
      </span>
    `;

    el.addEventListener("click", () => {
      ext.runtime.sendMessage({ type: opt.reorderAction }).catch(() => {});
    });

    grid.appendChild(el);
  }

  listEl.appendChild(grid);
  updateSelection();
  updateHeader("Reorder tabs");
}

// ---------------------------------------------------------------------------
// Close-and-select submenu — close current tab, then activate chosen target.
// ---------------------------------------------------------------------------

async function showCloseAndSelect() {
  currentView = "close-and-select";
  sectionStarts = [0];

  let allTabs = [];
  let activeTab = null;
  let defaultCloseTargetDomId = null;
  try {
    [allTabs, defaultCloseTargetDomId] = await Promise.all([
      ext.runtime.sendMessage({ type: "get-all-tabs" }),
      ext.runtime.sendMessage({ type: "get-default-close-target" }).catch(() => null),
    ]);
    activeTab = allTabs.find((t) => t.active);
  } catch (e) {}

  if (!workspaceMap || Object.keys(workspaceMap).length === 0) {
    await fetchWorkspaceMap();
  }

  const buildPreview = (tab) => tab
    ? { title: tab.title, favIconUrl: tab.favIconUrl, domId: tab.domId, workspaceId: tab.workspaceId, pending: tab.pending }
    : null;

  // Previous: most-recently-accessed tab excluding current (and split siblings)
  let previousPreview = null;
  if (activeTab) {
    const visibleDomIds = new Set([activeTab.domId]);
    if (activeTab.splitGroupId) {
      allTabs.filter((t) => t.splitGroupId === activeTab.splitGroupId).forEach((t) => visibleDomIds.add(t.domId));
    }
    const candidates = allTabs
      .filter((t) => !visibleDomIds.has(t.domId) && !t.unread)
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    previousPreview = buildPreview(candidates[0]);
  }

  // Parent
  const parentTab = activeTab?.openerTabDomId
    ? allTabs.find((t) => t.domId === activeTab.openerTabDomId) : null;
  const parentPreview = buildPreview(parentTab);

  // Siblings (in DOM order = allTabs order)
  const siblings = activeTab?.openerTabDomId
    ? allTabs.filter((t) => t.openerTabDomId === activeTab.openerTabDomId) : [];
  const sibIdx = activeTab ? siblings.findIndex((t) => t.domId === activeTab.domId) : -1;
  const nextSiblingPreview = (sibIdx >= 0 && sibIdx < siblings.length - 1) ? buildPreview(siblings[sibIdx + 1]) : null;
  const prevSiblingPreview = (sibIdx > 0) ? buildPreview(siblings[sibIdx - 1]) : null;

  // Vertical (same workspace, DOM order)
  const wsTabs = activeTab ? allTabs.filter((t) => t.workspaceId === activeTab.workspaceId) : [];
  const vIdx = activeTab ? wsTabs.findIndex((t) => t.domId === activeTab.domId) : -1;
  const nextVerticalPreview = (vIdx >= 0 && vIdx < wsTabs.length - 1) ? buildPreview(wsTabs[vIdx + 1]) : null;
  const prevVerticalPreview = (vIdx > 0) ? buildPreview(wsTabs[vIdx - 1]) : null;

  const defaultPreview = defaultCloseTargetDomId
    ? buildPreview(allTabs.find((t) => t.domId === defaultCloseTargetDomId))
    : null;

  const previewByActionId = {
    "close-and-select-default":       defaultPreview,
    "close-and-select-previous":      previousPreview,
    "close-and-select-parent":        parentPreview,
    "close-and-select-next-sibling":  nextSiblingPreview,
    "close-and-select-prev-sibling":  prevSiblingPreview,
    "close-and-select-next-vertical": nextVerticalPreview,
    "close-and-select-prev-vertical": prevVerticalPreview,
  };
  const options = kbChildrenOf("close-and-select").map((c) => ({
    label: c.label,
    hotkey: c.chord,
    icon: c.icon,
    closeAndSelectAction: c.id,
    preview: previewByActionId[c.id] || null,
    // The default close lets the browser pick the next tab — always enabled,
    // no specific target tab to preview.
    isDefault: c.id === "close-and-select-default",
  }));

  items = options;
  selectedIndex = -1;
  listEl.innerHTML = "";

  for (const opt of options) {
    const disabled = !opt.isDefault && !opt.preview;

    const el = document.createElement("div");
    el.className = "list-item close-and-select-row" + (disabled ? " disabled" : "");

    let previewHtml = `<span class="action-preview"></span>`;
    if (opt.isDefault && !opt.preview) {
      previewHtml = `<span class="action-preview"><span class="preview-hint">browser picks next tab</span></span>`;
    } else if (opt.preview && !disabled) {
      let prevFav = opt.preview.favIconUrl || "";
      if (prevFav.startsWith("moz-remote-image://")) {
        try { prevFav = new URL(prevFav).searchParams.get("url") || ""; } catch (e) { prevFav = ""; }
      }
      const canLoad = prevFav && !prevFav.startsWith("chrome://");
      const iconHtml = canLoad
        ? `<img class="preview-icon" src="${escapeAttr(prevFav)}">`
        : `<span class="preview-icon-placeholder">○</span>`;
      const previewTitle = escapeHtml(opt.preview.title || "Untitled");
      let wsLabel = "";
      if (opt.preview.workspaceId && opt.preview.workspaceId !== activeWorkspaceId) {
        const ws = workspaceMap[opt.preview.workspaceId];
        if (ws) {
          const wsIcon = ws.svgContent ? `<span class="row-ws-icon">${ws.svgContent}</span>` : "";
          wsLabel = `<span class="row-workspace">${wsIcon}${escapeHtml(ws.name)}</span>`;
        }
      }
      const pendingCls = opt.preview.pending ? " tab-pending" : "";
      previewHtml = `<span class="action-preview${pendingCls}">${iconHtml}<span class="preview-title">${previewTitle}</span>${wsLabel}</span>`;
    }

    el.innerHTML = `
      <span class="item-icon-placeholder">${getIcon(opt.icon)}</span>
      <span class="item-text">
        <span class="item-title">${escapeHtml(opt.label)}</span>
      </span>
      ${previewHtml}
      <span class="item-right">${renderBadge(displayKey(opt.hotkey))}</span>
    `;

    const img = el.querySelector("img.preview-icon");
    if (img) {
      img.addEventListener("error", () => { img.style.display = "none"; });
    }

    if (!disabled) {
      el.addEventListener("click", () => {
        ext.runtime.sendMessage({ type: opt.closeAndSelectAction }).catch(() => {});
      });
      if (opt.preview?.domId) {
        el.addEventListener("mouseenter", () => {
          ext.runtime.sendMessage({ type: "preview-tab", domId: opt.preview.domId }).catch(() => {});
        });
        el.addEventListener("mouseleave", () => {
          ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
        });
      }
    }

    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader("Close & select…");
}

// ---------------------------------------------------------------------------
// Most visited submenu
// ---------------------------------------------------------------------------

async function showMostVisited(animate) {
  currentView = "most-visited";
  items = [];
  selectedIndex = -1;
  sectionStarts = [0];

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader("Most visited");
    return;
  }

  let filtered = filterByWorkspace(allTabs.filter((t) => t.url && !t.url.startsWith("about:")));

  // Get visit counts for all unique URLs in parallel
  const uniqueUrls = [...new Set(filtered.map((t) => t.url))];
  const visitCounts = {};
  try {
    const results = await Promise.all(
      uniqueUrls.map((url) => ext.runtime.sendMessage({ type: "get-history-visits", url }).then(
        (visits) => ({ url, count: visits.length }),
        () => ({ url, count: 0 })
      ))
    );
    for (const r of results) visitCounts[r.url] = r.count;
  } catch (e) {}

  // Sort by visit count descending
  filtered.sort((a, b) => (visitCounts[b.url] || 0) - (visitCounts[a.url] || 0));

  // Render using a custom list that shows visit count in subtitle
  selectedIndex = -1;
  listEl.innerHTML = "";
  const now = Date.now();

  if (filtered.length === 0) {
    items = [];
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader("Most visited");
    return;
  }

  items = filtered;

  for (let i = 0; i < filtered.length; i++) {
    const tab = filtered[i];
    const badge = (i + 1) <= 9 ? String(i + 1) : null;
    const visits = visitCounts[tab.url] || 0;

    const el = document.createElement("div");
    el.className = "list-item" + (tab.pending ? " tab-pending" : "");
    el.dataset.domId = tab.domId;

    let domain = "";
    try { domain = new URL(tab.url).hostname; } catch (e) {}

    let favicon = tab.favIconUrl || "";
    if (favicon.startsWith("moz-remote-image://")) {
      try { favicon = new URL(favicon).searchParams.get("url") || ""; } catch (e) { favicon = ""; }
    }
    const canLoadFavicon = favicon && !favicon.startsWith("chrome://");

    let wsHtml = "";
    if (tab.workspaceId && tab.workspaceId !== activeWorkspaceId) {
      const ws = workspaceMap[tab.workspaceId];
      if (ws) {
        const wsIcon = ws.svgContent ? `<span class="row-ws-icon">${ws.svgContent}</span>` : "";
        wsHtml = `<span class="row-workspace">${wsIcon}${escapeHtml(ws.name)}</span>`;
      }
    }

    const subtitleParts = [
      domain ? `<span class="subtitle-domain">${escapeHtml(domain)}</span>` : "",
      `<span class="subtitle-age">${visits} visits</span>`,
    ].filter(Boolean).join("");

    const badgeHtml = badge !== null
      ? `<span class="item-badge">${badge}</span>`
      : `<span class="item-badge-placeholder"></span>`;

    el.innerHTML = `
      ${canLoadFavicon
        ? `<img class="item-icon" src="${escapeAttr(favicon)}">`
        : `<span class="item-icon-placeholder">○</span>`}
      <span class="item-text">
        <span class="item-title">${escapeHtml(tab.title || "Untitled")}</span>
        <span class="item-subtitle">${subtitleParts}</span>
      </span>
      <span class="item-right">${wsHtml}${badgeHtml}</span>
    `;

    const img = el.querySelector("img.item-icon");
    if (img) img.addEventListener("error", () => { img.style.display = "none"; });

    el.addEventListener("click", () => activateTab(tab.domId));
    el.addEventListener("mouseenter", () => {
      ext.runtime.sendMessage({ type: "preview-tab", domId: tab.domId }).catch(() => {});
    });
    el.addEventListener("mouseleave", () => {
      ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
    });

    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader("Most visited");
  renderSidebar();
}

function renderWorkspaceSwitcher(container) {
  const allWorkspaces = Object.entries(workspaceMap);
  if (allWorkspaces.length === 0) return;

  const grid = document.createElement("div");
  grid.className = "actions-grid";

  for (let i = 0; i < allWorkspaces.length; i++) {
    const [uuid, ws] = allWorkspaces[i];
    const isActive = uuid === activeWorkspaceId;
    const badge = (i + 1) <= 9 ? String(i + 1) : null;

    const el = document.createElement("div");
    el.className = "list-item compact-item" + (isActive ? " ws-active" : "");
    el.dataset.workspaceSwitchId = uuid;

    const iconHtml = ws.svgContent
      ? `<span class="item-icon-placeholder"><span class="workspace-icon">${ws.svgContent}</span></span>`
      : `<span class="item-icon-placeholder">○</span>`;

    const tabCount = workspaceTabCounts[uuid] || 0;

    el.innerHTML = `
      ${iconHtml}
      <span class="item-text">
        <span class="item-title">${escapeHtml(ws.name)}<span class="item-count">${tabCount}</span></span>
      </span>
      <span class="item-right">
        ${badge !== null ? `<span class="item-badge">${badge}</span>` : ""}
        <span class="item-arrow"></span>
      </span>
    `;

    if (!isActive) {
      el.addEventListener("click", () => {
        ext.runtime.sendMessage({ type: "switch-workspace", workspaceId: uuid }).catch(() => {});
      });
    }

    grid.appendChild(el);
  }

  container.appendChild(grid);
}

function moveToWorkspace(workspaceId) {
  ext.runtime.sendMessage({ type: "move-selected-tabs-to-workspace", workspaceId }).catch(() => {});
}

function goBack() {
  if (currentView !== "actions") {
    navigateBack();
  }
}

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      if (e.metaKey && !sidebarFocused) {
        selectedIndex = items.length - 1;
        updateSelection();
      } else if (sidebarFocused) moveSidebarSelection(1);
      else moveSelection(1);
      break;

    case "ArrowUp":
      e.preventDefault();
      if (e.metaKey && !sidebarFocused) {
        selectedIndex = 0;
        updateSelection();
      } else if (sidebarFocused) moveSidebarSelection(-1);
      else moveSelection(-1);
      break;

    case "Tab":
      e.preventDefault();
      jumpToSection(e.shiftKey ? -1 : 1);
      break;

    case "ArrowRight":
      e.preventDefault();
      if (!sidebarFocused && selectedIndex >= 0 && items[selectedIndex]?.isView) { activateSelected(); }
      break;

    case "ArrowLeft":
      e.preventDefault();
      if (!sidebarFocused && currentView !== "actions") { goBack(); }
      break;

    case "Enter":
      e.preventDefault();
      if (sidebarFocused) { activateSidebarSelected(); }
      else { activateSelected(); }
      break;

    case "Escape":
      closePalette();
      break;

    case "Backspace":
      if (currentView !== "actions") {
        e.preventDefault();
        goBack();
      }
      break;

    default:
      if (currentView === "actions" || currentView === "reorder-tabs" || currentView === "close-and-select") {
        // Number keys 1-9 for workspace switching in actions view
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= 9) {
          let wsHandled = false;
          const wsItems = listEl.querySelectorAll(".list-item[data-workspace-switch-id]");
          for (const wsEl of wsItems) {
            const badge = wsEl.querySelector(".item-badge");
            if (badge && badge.textContent === String(num)) {
              e.preventDefault();
              ext.runtime.sendMessage({ type: "switch-workspace", workspaceId: wsEl.dataset.workspaceSwitchId }).catch(() => {});
              wsHandled = true;
              break;
            }
          }
          if (wsHandled) break;
        }
        const key = chordFromEvent(e);
        const idx = items.findIndex((item) => item.hotkey === key);
        if (idx >= 0) {
          const listItems = listEl.querySelectorAll(".list-item");
          if (!listItems[idx]?.classList.contains("disabled")) {
            e.preventDefault();
            if (items[idx].reorderAction) {
              ext.runtime.sendMessage({ type: items[idx].reorderAction }).catch(() => {});
            } else if (items[idx].closeAndSelectAction) {
              ext.runtime.sendMessage({ type: items[idx].closeAndSelectAction }).catch(() => {});
            } else {
              activateAction(items[idx]);
            }
          }
        }
      } else {
        // B/F keys for back/forward in navigation view
        if (currentView === "navigation" && (e.key.toUpperCase() === "B" || e.key.toUpperCase() === "F")) {
          const navItem = e.key.toUpperCase() === "B"
            ? items.find((it) => it.navIndex !== undefined && it.navIndex === items.find((c) => c.isCurrent)?.navIndex - 1)
            : items.find((it) => it.navIndex !== undefined && it.navIndex === items.find((c) => c.isCurrent)?.navIndex + 1);
          if (navItem && !navItem.isCurrent) {
            e.preventDefault();
            ext.runtime.sendMessage({ type: "navigate-to-history-index", index: navItem.navIndex }).catch(() => {});
          }
          break;
        }
        // S key for sort toggles
        if (e.key.toUpperCase() === "S") {
          if (currentView === "domains" || currentView === "domain-tabs") {
            e.preventDefault();
            domainsSortAlpha = !domainsSortAlpha;
            refreshCurrentView();
            break;
          }
          if (currentView === "tabs-by-age") {
            e.preventDefault();
            tabsByAgeNewestFirst = !tabsByAgeNewestFirst;
            refreshCurrentView();
            break;
          }
        }
        // 0 toggles workspace filter (all vs current workspace)
        if (e.key === "0" && !e.shiftKey && !sidebarEl.classList.contains("hidden")) {
          e.preventDefault();
          workspaceFilter = workspaceFilter === "all" ? activeWorkspaceId : "all";
          refreshCurrentView();
          break;
        }
        // Shift+1-9 for workspace filtering
        if (e.shiftKey && !sidebarEl.classList.contains("hidden") && e.code && e.code.startsWith("Digit")) {
          const num = parseInt(e.code.slice(5), 10);
          if (num >= 1 && num <= 9) {
            const allWorkspaces = Object.entries(workspaceMap);
            const wsIndex = num - 1;
            if (wsIndex < allWorkspaces.length) {
              e.preventDefault();
              const uuid = allWorkspaces[wsIndex][0];
              workspaceFilter = workspaceFilter === uuid ? "all" : uuid;
              refreshCurrentView();
            }
            break;
          }
        }
        // Number keys 1-9 activate list items
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= 9) {
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
            const badges = listItems[i].querySelectorAll(".item-badge");
            const matched = Array.from(badges).some((b) => b.textContent === String(num));
            if (matched) {
              e.preventDefault();
              // Navigation history item
              if (items[i]?.navIndex !== undefined && !items[i]?.isCurrent) {
                ext.runtime.sendMessage({ type: "navigate-to-history-index", index: items[i].navIndex }).catch(() => {});
                break;
              }
              const wsSwitchId = listItems[i].dataset.workspaceSwitchId;
              if (wsSwitchId) { ext.runtime.sendMessage({ type: "switch-workspace", workspaceId: wsSwitchId }).catch(() => {}); break; }
              const wsId = listItems[i].dataset.workspaceId;
              if (wsId) { moveToWorkspace(wsId); break; }
              const sessionId = listItems[i].dataset.sessionId;
              if (sessionId) { ext.runtime.sendMessage({ type: "restore-closed-tab", sessionId }).catch(() => {}); break; }
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

// Render a hotkey badge. Multi-character labels (e.g. "⇧R", "⇧1") get the
// wider min-width so paired-shift variants line up with single-char badges.
function renderBadge(text) {
  if (text == null || text === "") return "";
  const s = String(text);
  const wide = s.length > 1 ? " badge-wide" : "";
  return `<span class="item-badge${wide}">${escapeHtml(s)}</span>`;
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

const initialView = urlParams.get("view");
const paramDomain = urlParams.get("domain");
const paramWorkspace = urlParams.get("workspace");

async function init() {
  if (paramWorkspace) workspaceFilter = paramWorkspace;
  if (paramDomain) currentDomain = paramDomain;

  if (initialView) {
    await fetchWorkspaceMap();
    switch (initialView) {
      case "child-tabs": await showChildTabs(); break;
      case "sibling-tabs": await showSiblingTabs(); break;
      case "parent-tabs": await showParentTabs(); break;
      case "navigation": await showNavigation(); break;
      case "unvisited-tabs": await showUnvisitedTabs(); break;
      case "last-visited": await showLastVisited(); break;
      case "recently-closed": await showRecentlyClosed(); break;
      case "duplicates": await showDuplicates(); break;
      case "tab-info": await showTabInfo(); break;
      case "domains": await showDomains(); break;
      case "domain-tabs": await showDomainTabs(paramDomain); break;
      case "tabs-by-age": await showTabsByAge(); break;
      case "most-visited": await showMostVisited(); break;
      case "reorder-tabs": showReorderTabs(); break;
      case "move-to-workspace": await showMoveToWorkspace(); break;
      case "close-and-select": await showCloseAndSelect(); break;
    }
  } else {
    await showActionsMenu();
  }
}

init();