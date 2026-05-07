"use strict";

// Actions menu — main palette landing view
//
// Loaded as <script src="views/actions.js"> from popup.html. Cross-file
// references (ui/tabState/wsState, DOM refs, render.js helpers, popup.js
// helpers, shared/dom-utils.js) resolve via the shared script-global scope.

function getActions() {
  const compact = { compact: true };

  // Substitute the actual prev/next workspace SVG icons in place of the
  // generic arrow icons, so the user sees which workspace they'd jump to.
  const wsList = Object.entries(wsState.workspaceMap);
  const activeIdx = wsList.findIndex(([uuid]) => uuid === wsState.activeWorkspaceId);
  let prevWsIconHtml = null;
  let nextWsIconHtml = null;
  if (activeIdx >= 0 && wsList.length > 1) {
    const prevSvg = wsList[(activeIdx - 1 + wsList.length) % wsList.length][1].svgContent;
    const nextSvg = wsList[(activeIdx + 1) % wsList.length][1].svgContent;
    if (prevSvg) prevWsIconHtml = `<span class="workspace-icon">${prevSvg}</span>`;
    if (nextSvg) nextWsIconHtml = `<span class="workspace-icon">${nextSvg}</span>`;
  }

  return [
    { type: "section", label: "Navigate", navigateGrid: true },
    // 3 columns × 2 rows in column-first DOM order:
    // [Previous] [Back   ] [Above]
    // [Parent  ] [Forward] [Below]
    actionFromRegistry("go-to-previous-tab",      { preview: tabState.previousTabPreview }),
    actionFromRegistry("go-to-parent-tab",        { preview: tabState.parentTabPreview }),
    actionFromRegistry("go-back-in-tab",          { preview: tabState.backPreview }),
    actionFromRegistry("go-forward-in-tab",       { preview: tabState.forwardPreview }),
    actionFromRegistry("go-to-prev-vertical-tab", { preview: tabState.prevVerticalPreview }),
    actionFromRegistry("go-to-next-vertical-tab", { preview: tabState.nextVerticalPreview }),

    { type: "section", label: "This tab", column: true },
    actionFromRegistry("tab-info",        compact),
    actionFromRegistry("navigation",      compact),
    actionFromRegistry("child-tabs",      { count: tabState.childTabCount, ...compact }),
    actionFromRegistry("sibling-tabs",    { count: tabState.siblingTabCount, ...compact }),

    { type: "section", label: "Tab actions", column: true, stack: true },
    actionFromRegistry("copy-url-markdown",       compact),
    actionFromRegistry("restore-last-closed-tab", compact),
    actionFromRegistry("unload-tab",              compact),
    actionFromRegistry("close-and-select",        compact),

    { type: "section", label: "All tabs", column: true },
    actionFromRegistry("parent-tabs",     { count: tabState.parentTabCount, ...compact }),
    actionFromRegistry("unvisited-tabs",  { count: tabState.unvisitedTabCount, ...compact }),
    actionFromRegistry("last-visited",    compact),
    actionFromRegistry("recently-closed", { count: tabState.recentlyClosedCount, ...compact }),
    actionFromRegistry("duplicates",      { count: tabState.duplicateGroupCount, ...compact }),
    actionFromRegistry("domains",         { count: tabState.domainCount, ...compact }),
    actionFromRegistry("tabs-by-age",     compact),
    actionFromRegistry("most-visited",    compact),

    { type: "section", label: "Organize", column: true },
    actionFromRegistry("toggle-pin-tab",         compact),
    actionFromRegistry("move-tab-to-start",     compact),
    actionFromRegistry("move-tab-to-end",       compact),
    actionFromRegistry("reorder-tabs",          compact),
    actionFromRegistry("move-to-workspace",     { count: tabState.selectedTabCount > 1 ? tabState.selectedTabCount : 0, ...compact }),
    actionFromRegistry("scroll-to-current-tab", compact),
    actionFromRegistry("split-view",            compact),

    { type: "section", label: "Workspaces", column: true },
    actionFromRegistry("go-to-prev-workspace",  { ...compact, iconHtml: prevWsIconHtml }),
    actionFromRegistry("go-to-next-workspace",  { ...compact, iconHtml: nextWsIconHtml }),
    { type: "workspaces" },

    { type: "section", label: "Other", column: true, stack: true },
    actionFromRegistry("open-options", compact),
  ];
}
function isActionDisabled(action) {
  if (action.needsParent && !tabState.currentTabHasParent) return true;
  if (action.needsChildren && tabState.childTabCount === 0) return true;
  if (action.needsUnvisited && tabState.unvisitedTabCount === 0) return true;
  if (action.needsSiblings && tabState.siblingTabCount === 0) return true;
  if (action.needsParentTabs && tabState.parentTabCount === 0) return true;
  if (action.needsDuplicates && tabState.duplicateGroupCount === 0) return true;
  if (action.needsRecentlyClosed && tabState.recentlyClosedCount === 0) return true;
  return false;
}
function buildPreviewHtml(preview) {
  if (!preview) return "";

  if (preview.isHistory) {
    let domain = "";
    try { domain = new URL(preview.url).hostname.replace(/^www\./, ""); } catch (e) {}
    const titleHtml = escapeHtml(preview.title || preview.url || "Untitled");
    const domainHtml = domain ? `<span class="row-workspace">${escapeHtml(domain)}</span>` : "";
    return `<span class="action-preview"><span class="preview-icon-placeholder">○</span><span class="preview-title">${titleHtml}</span>${domainHtml}</span>`;
  }

  let prevFav = preview.favIconUrl || "";
  if (prevFav.startsWith("moz-remote-image://")) {
    try { prevFav = new URL(prevFav).searchParams.get("url") || ""; } catch (e) { prevFav = ""; }
  }
  const canLoad = prevFav && !prevFav.startsWith("chrome://");
  const iconHtml = canLoad
    ? `<img class="preview-icon" src="${escapeAttr(prevFav)}">`
    : `<span class="preview-icon-placeholder">○</span>`;
  const previewTitle = escapeHtml(preview.title || "Untitled");
  let wsLabel = "";
  if (preview.workspaceId && preview.workspaceId !== wsState.activeWorkspaceId) {
    const ws = wsState.workspaceMap[preview.workspaceId];
    if (ws) {
      const wsIcon = ws.svgContent ? `<span class="row-ws-icon">${ws.svgContent}</span>` : "";
      wsLabel = `<span class="row-workspace">${wsIcon}${escapeHtml(ws.name)}</span>`;
    }
  }
  const pendingCls = preview.pending ? " tab-pending" : "";
  return `<span class="action-preview${pendingCls}">${iconHtml}<span class="preview-title">${previewTitle}</span>${wsLabel}</span>`;
}

function buildNavigateCell(action) {
  const disabled = !action.preview;
  const cell = document.createElement("div");
  cell.className = "navigate-cell list-item compact-item" + (disabled ? " disabled" : "");
  cell.dataset.id = action.id;

  // Icon: favicon if preview has one (and it's a tab, not history), else fall
  // back to the action's own icon.
  let iconHtml = "";
  if (action.preview && !action.preview.isHistory) {
    let fav = action.preview.favIconUrl || "";
    if (fav.startsWith("moz-remote-image://")) {
      try { fav = new URL(fav).searchParams.get("url") || ""; } catch (e) { fav = ""; }
    }
    if (fav && !fav.startsWith("chrome://")) {
      iconHtml = `<img class="item-icon" src="${escapeAttr(fav)}">`;
    }
  }
  if (!iconHtml) {
    iconHtml = `<span class="item-icon-placeholder">${getIcon(action.icon)}</span>`;
  }

  // Inline tab/page title + workspace-or-domain badge.
  // Always emit the title span (empty when no preview) so it flex-grows
  // and keeps the hotkey badge anchored to the right edge of the cell.
  const titleText = action.preview ? (action.preview.title || "Untitled") : "";
  const titleHtml = `<span class="navigate-cell-title">${escapeHtml(titleText)}</span>`;
  let trailingHtml = "";
  if (action.preview) {
    if (action.preview.isHistory) {
      let domain = "";
      try { domain = new URL(action.preview.url || "").hostname.replace(/^www\./, ""); } catch (e) {}
      if (domain) trailingHtml = `<span class="row-workspace">${escapeHtml(domain)}</span>`;
    } else if (action.preview.workspaceId && action.preview.workspaceId !== wsState.activeWorkspaceId) {
      const ws = wsState.workspaceMap[action.preview.workspaceId];
      if (ws) {
        const wsIcon = ws.svgContent ? `<span class="row-ws-icon">${ws.svgContent}</span>` : "";
        trailingHtml = `<span class="row-workspace">${wsIcon}${escapeHtml(ws.name)}</span>`;
      }
    }
  }

  cell.innerHTML = `
    ${iconHtml}
    <span class="navigate-cell-label">${escapeHtml(action.label)}</span>
    ${titleHtml}
    ${trailingHtml}
    ${renderBadge(displayKey(action.hotkey))}
  `;

  const img = cell.querySelector("img.item-icon");
  if (img) img.addEventListener("error", () => { img.style.display = "none"; });

  if (!disabled) {
    cell.addEventListener("click", () => activateAction(action));
    if (action.preview?.domId) {
      cell.addEventListener("mouseenter", () => {
        ext.runtime.sendMessage({ type: "preview-tab", domId: action.preview.domId }).catch(() => {});
      });
      cell.addEventListener("mouseleave", () => {
        ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
      });
    }
  }

  return cell;
}

function renderActions(actions, title) {
  actions = actions.filter(Boolean);
  ui.items = actions.filter((a) => a.type !== "separator" && a.type !== "workspaces" && a.type !== "section");
  ui.selectedIndex = -1;
  ui.sectionStarts = [0];

  listEl.innerHTML = "";
  let gridContainer = null;
  let columnsContainer = null;
  let currentColumn = null;
  let navigateGrid = null;
  let itemIndex = 0;

  const closeColumns = () => { columnsContainer = null; currentColumn = null; };
  const closeNavigateGrid = () => { navigateGrid = null; };

  for (const action of actions) {
    if (action.type === "section") {
      gridContainer = null;
      const header = document.createElement("div");
      header.className = "list-section-header";
      header.textContent = action.label;
      if (action.navigateGrid) {
        closeColumns();
        listEl.appendChild(header);
        navigateGrid = document.createElement("div");
        navigateGrid.className = "navigate-grid";
        listEl.appendChild(navigateGrid);
      } else if (action.column) {
        closeNavigateGrid();
        if (!columnsContainer) {
          columnsContainer = document.createElement("div");
          columnsContainer.className = "sections-row";
          listEl.appendChild(columnsContainer);
        }
        if (action.stack && currentColumn) {
          // Stack this section in the existing column rather than starting a new one
          currentColumn.appendChild(header);
        } else {
          currentColumn = document.createElement("div");
          currentColumn.className = "section-column";
          currentColumn.appendChild(header);
          columnsContainer.appendChild(currentColumn);
        }
      } else {
        closeColumns();
        closeNavigateGrid();
        listEl.appendChild(header);
      }
      ui.sectionStarts.push(itemIndex);
      continue;
    }

    if (action.type === "separator") {
      gridContainer = null;
      closeColumns();
      closeNavigateGrid();
      const sep = document.createElement("div");
      sep.className = "list-separator";
      listEl.appendChild(sep);
      ui.sectionStarts.push(itemIndex);
      continue;
    }

    if (action.type === "workspaces") {
      gridContainer = null;
      if (currentColumn) {
        renderWorkspaceSwitcher(currentColumn, "single");
      } else {
        renderWorkspaceSwitcher(listEl, "grid");
      }
      continue;
    }

    if (navigateGrid) {
      const cell = buildNavigateCell(action);
      navigateGrid.appendChild(cell);
      itemIndex++;
      continue;
    }

    const disabled = isActionDisabled(action);

    const el = document.createElement("div");
    el.className = "list-item" + (disabled ? " disabled" : "") + (action.compact ? " compact-item" : "");
    el.dataset.id = action.id;

    const previewHtml = (action.preview && !disabled) ? buildPreviewHtml(action.preview) : "";

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
      <span class="item-icon-placeholder">${action.iconHtml || getIcon(action.icon)}</span>
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

    if (currentColumn) {
      gridContainer = null;
      currentColumn.appendChild(el);
    } else if (action.compact) {
      if (!gridContainer) {
        gridContainer = document.createElement("div");
        gridContainer.className = "actions-grid";
        listEl.appendChild(gridContainer);
      }
      gridContainer.appendChild(el);
    } else {
      gridContainer = null;
      closeColumns();
      listEl.appendChild(el);
    }
    itemIndex++;
  }

  updateSelection();
  updateHeader(title);
}
async function fetchWorkspaceMap() {
  try {
    const workspaces = await ext.runtime.sendMessage({ type: "get-workspaces-with-icons" });
    wsState.workspaceMap = {};
    wsState.activeWorkspaceId = null;
    for (const ws of workspaces) {
      wsState.workspaceMap[ws.uuid] = { name: ws.name, svgContent: ws.svgContent };
      if (ws.isActive) wsState.activeWorkspaceId = ws.uuid;
    }
  } catch (e) {
    wsState.workspaceMap = {};
    wsState.activeWorkspaceId = null;
  }
}
async function showActionsMenu() {
  ui.currentView = "actions";

  // Fetch tab info for disabling unavailable actions and previews
  try {
    const allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
    const activeTab = allTabs.find((t) => t.active);
    tabState.currentTabHasParent = !!(activeTab && activeTab.openerTabDomId);
    tabState.childTabCount = activeTab ? allTabs.filter((t) => t.openerTabDomId === activeTab.domId).length : 0;
    tabState.siblingTabCount = (activeTab && activeTab.openerTabDomId)
      ? allTabs.filter((t) => t.openerTabDomId === activeTab.openerTabDomId && t.domId !== activeTab.domId).length
      : 0;
    tabState.unvisitedTabCount = allTabs.filter((t) => t.unread).length;
    const childOpeners = new Set(allTabs.filter((t) => t.openerTabDomId).map((t) => t.openerTabDomId));
    tabState.parentTabCount = allTabs.filter((t) => childOpeners.has(t.domId)).length;
    const domainSet = new Set();
    for (const t of allTabs) { try { domainSet.add(new URL(t.url).hostname); } catch (e) {} }
    domainSet.delete("");
    tabState.domainCount = domainSet.size;

    // Workspace tab counts
    tabState.workspaceTabCounts = {};
    for (const t of allTabs) {
      if (t.workspaceId) tabState.workspaceTabCounts[t.workspaceId] = (tabState.workspaceTabCounts[t.workspaceId] || 0) + 1;
    }

    // Duplicate groups count
    const urlCounts = {};
    for (const t of allTabs) {
      if (t.url && t.url !== "about:newtab" && t.url !== "about:blank") {
        urlCounts[t.url] = (urlCounts[t.url] || 0) + 1;
      }
    }
    tabState.duplicateGroupCount = Object.values(urlCounts).filter((c) => c > 1).length;

    try {
      const closed = await ext.runtime.sendMessage({ type: "get-recently-closed" });
      tabState.recentlyClosedCount = Array.isArray(closed) ? closed.length : 0;
    } catch (e) {
      tabState.recentlyClosedCount = 0;
    }

    // Parent tab preview
    if (tabState.currentTabHasParent) {
      const parent = allTabs.find((t) => t.domId === activeTab.openerTabDomId);
      tabState.parentTabPreview = parent ? { title: parent.title, favIconUrl: parent.favIconUrl, domId: parent.domId, workspaceId: parent.workspaceId, pending: parent.pending } : null;
    } else {
      tabState.parentTabPreview = null;
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
    tabState.previousTabPreview = candidates.length > 0
      ? { title: candidates[0].title, favIconUrl: candidates[0].favIconUrl, domId: candidates[0].domId, workspaceId: candidates[0].workspaceId, pending: candidates[0].pending }
      : null;

    // Vertical-bar neighbors (above/below the current tab in the sidebar,
    // same workspace). Reuses the DOM order in allTabs.
    if (activeTab) {
      const sameWs = allTabs.filter((t) => t.workspaceId === activeTab.workspaceId);
      const vIdx = sameWs.findIndex((t) => t.domId === activeTab.domId);
      const buildTabPreview = (tab) => tab
        ? { title: tab.title, favIconUrl: tab.favIconUrl, domId: tab.domId, workspaceId: tab.workspaceId, pending: tab.pending }
        : null;
      tabState.prevVerticalPreview = vIdx > 0 ? buildTabPreview(sameWs[vIdx - 1]) : null;
      tabState.nextVerticalPreview = vIdx >= 0 && vIdx < sameWs.length - 1 ? buildTabPreview(sameWs[vIdx + 1]) : null;
    } else {
      tabState.prevVerticalPreview = null;
      tabState.nextVerticalPreview = null;
    }

    // Back/forward previews from the active tab's session history.
    try {
      const navHist = await ext.runtime.sendMessage({ type: "get-navigation-history" });
      if (navHist && Array.isArray(navHist.entries)) {
        const i = navHist.index;
        tabState.backPreview = i > 0
          ? { title: navHist.entries[i - 1].title, url: navHist.entries[i - 1].url, isHistory: true }
          : null;
        tabState.forwardPreview = i < navHist.entries.length - 1
          ? { title: navHist.entries[i + 1].title, url: navHist.entries[i + 1].url, isHistory: true }
          : null;
      } else {
        tabState.backPreview = null;
        tabState.forwardPreview = null;
      }
    } catch (e) {
      tabState.backPreview = null;
      tabState.forwardPreview = null;
    }

    // Fetch selected tab count and workspace map in parallel
    try {
      const [selectedDomIds] = await Promise.all([
        ext.runtime.sendMessage({ type: "get-selected-tab-dom-ids" }),
        fetchWorkspaceMap(),
      ]);
      tabState.selectedTabCount = selectedDomIds.length;
    } catch (e) {
      tabState.selectedTabCount = 0;
    }
  } catch (e) {
    tabState.currentTabHasParent = false;
    tabState.childTabCount = 0;
    tabState.siblingTabCount = 0;
    tabState.parentTabCount = 0;
    tabState.domainCount = 0;
    tabState.unvisitedTabCount = 0;
    tabState.duplicateGroupCount = 0;
    tabState.recentlyClosedCount = 0;
    tabState.parentTabPreview = null;
    tabState.previousTabPreview = null;
    tabState.backPreview = null;
    tabState.forwardPreview = null;
    tabState.nextVerticalPreview = null;
    tabState.prevVerticalPreview = null;
    tabState.selectedTabCount = 0;
  }

  if (!initialView) {
    renderActions(getActions(), null);
    hideSidebar();
  }
}
function renderWorkspaceSwitcher(container, layout = "grid") {
  const allWorkspaces = Object.entries(wsState.workspaceMap);
  if (allWorkspaces.length === 0) return;

  let target;
  if (layout === "single") {
    target = container;
  } else {
    const grid = document.createElement("div");
    grid.className = "actions-grid";
    container.appendChild(grid);
    target = grid;
  }

  for (let i = 0; i < allWorkspaces.length; i++) {
    const [uuid, ws] = allWorkspaces[i];
    const isActive = uuid === wsState.activeWorkspaceId;
    const badge = (i + 1) <= 9 ? String(i + 1) : null;

    const el = document.createElement("div");
    el.className = "list-item compact-item" + (isActive ? " ws-active" : "");
    el.dataset.workspaceSwitchId = uuid;

    const iconHtml = ws.svgContent
      ? `<span class="item-icon-placeholder"><span class="workspace-icon">${ws.svgContent}</span></span>`
      : `<span class="item-icon-placeholder">○</span>`;

    const tabCount = tabState.workspaceTabCounts[uuid] || 0;

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

    target.appendChild(el);
  }
}
