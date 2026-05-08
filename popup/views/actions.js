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
    // 2 columns × 2 rows in column-first DOM order:
    // [Previous] [Above]
    // [Parent  ] [Below]
    actionFromRegistry("go-to-previous-tab",      { preview: tabState.previousTabPreview }),
    actionFromRegistry("go-to-parent-tab",        { preview: tabState.parentTabPreview }),
    actionFromRegistry("go-to-prev-vertical-tab", { preview: tabState.prevVerticalPreview }),
    actionFromRegistry("go-to-next-vertical-tab", { preview: tabState.nextVerticalPreview }),

    { type: "section", label: "This tab", column: true },
    actionFromRegistry("tab-info",        compact),
    actionFromRegistry("navigation",      compact),
    actionFromRegistry("child-tabs",      { count: tabState.childTabCount, ...compact }),
    actionFromRegistry("sibling-tabs",    { count: tabState.siblingTabCount, ...compact }),

    { type: "section", label: "Tab actions", column: true, stack: true },
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
    actionFromRegistry("move-to-folder",        compact),
    actionFromRegistry("scroll-to-current-tab", compact),
    actionFromRegistry("split-view",            compact),

    { type: "section", label: "Workspaces", column: true, scrollable: true },
    actionFromRegistry("go-to-prev-workspace",  { ...compact, iconHtml: prevWsIconHtml }),
    actionFromRegistry("go-to-next-workspace",  { ...compact, iconHtml: nextWsIconHtml }),
    { type: "workspaces" },

    // ----- Page 2 -----
    { type: "section", label: "Navigate", page: 2, navigateGrid: true },
    // Column-first 2x2 fill order:
    // [Back   ] [Newest unvisited]
    // [Forward] [Oldest unvisited]
    actionFromRegistry("go-back-in-tab",    { preview: tabState.backPreview }),
    actionFromRegistry("go-forward-in-tab", { preview: tabState.forwardPreview }),
    actionFromRegistry("unvisited-newest",  { preview: tabState.newestUnvisitedPreview }),
    actionFromRegistry("unvisited-oldest",  { preview: tabState.oldestUnvisitedPreview }),

    { type: "section", label: "This page", page: 2, column: true },
    actionFromRegistry("reload-tab",         compact),
    actionFromRegistry("reload-skip-cache",  compact),
    actionFromRegistry("duplicate-tab",      compact),
    actionFromRegistry("toggle-reader-mode", compact),
    actionFromRegistry("toggle-mute",        compact),
    actionFromRegistry("toggle-fullscreen",  compact),
    actionFromRegistry("toggle-pip",         compact),

    { type: "section", label: "Tab", page: 2, column: true },
    actionFromRegistry("reset-pinned-tab",   compact),
    actionFromRegistry("add-to-essentials",  compact),
    actionFromRegistry("open-in-container",  compact),

    { type: "section", label: "Developer", page: 2, column: true },
    actionFromRegistry("toggle-devtools",        compact),
    actionFromRegistry("toggle-browser-toolbox", compact),

    { type: "section", label: "Browser", page: 2, column: true, stack: true },
    actionFromRegistry("open-downloads", compact),
    actionFromRegistry("open-addons",    compact),

    { type: "section", label: "Page tools", page: 2, column: true },
    actionFromRegistry("view-page-source",  compact),
    actionFromRegistry("view-page-info",    compact),
    actionFromRegistry("take-screenshot",   compact),
    actionFromRegistry("copy-url-markdown", compact),

    { type: "section", label: "Other", page: 2, column: true, stack: true },
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
  if (action.needsPinnedTab && !tabState.currentTabIsPinned) return true;
  // Tab-history view is only useful when there's somewhere to navigate. With
  // 0 entries it's empty; with 1 entry it's just the current page (no back/
  // forward to choose from), so disable in both cases.
  if (action.needsHistory && tabState.navigationHistoryCount <= 1) return true;
  return false;
}
function buildPreviewHtml(preview) {
  if (!preview) return "";

  if (preview.isHistory) {
    const domain = extractDomain(preview.url).replace(/^www\./, "");
    const titleHtml = escapeHtml(preview.title || preview.url || "Untitled");
    const domainHtml = domain ? `<span class="row-workspace">${escapeHtml(domain)}</span>` : "";
    return `<span class="action-preview"><span class="preview-icon-placeholder">○</span><span class="preview-title">${titleHtml}</span>${domainHtml}</span>`;
  }

  const prevFav = extractFavicon(preview.favIconUrl);
  const iconHtml = prevFav
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

  // Leading icon is always the action's own vector icon — never the favicon.
  // Favicon (if available) lives inline next to the tab title.
  const iconHtml = `<span class="item-icon-placeholder">${getIcon(action.icon)}</span>`;

  // Inline favicon: only for non-history previews that have one.
  let inlineFaviconHtml = "";
  if (action.preview && !action.preview.isHistory) {
    const fav = extractFavicon(action.preview.favIconUrl);
    if (fav) inlineFaviconHtml = `<img class="navigate-cell-favicon" src="${escapeAttr(fav)}">`;
  }

  // Inline tab/page title + workspace-or-domain badge.
  // Always emit the title span (empty when no preview) so it flex-grows
  // and keeps the hotkey badge anchored to the right edge of the cell.
  const titleText = action.preview ? (action.preview.title || "Untitled") : "";
  const titleHtml = `<span class="navigate-cell-title">${inlineFaviconHtml}${escapeHtml(titleText)}</span>`;
  let trailingHtml = "";
  if (action.preview) {
    if (action.preview.isHistory) {
      const domain = extractDomain(action.preview.url || "").replace(/^www\./, "");
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

  const img = cell.querySelector("img.navigate-cell-favicon");
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
  // ui.items is built incrementally below so the workspaces marker can
  // expand into N synthetic entries (one per workspace) — that's what
  // makes arrow-key nav reach workspace switcher rows.
  ui.items = [];
  ui.selectedIndex = -1;
  ui.sectionStarts = [0];

  // Bucket sections + items by page. A section's page (default 1) sets the
  // bucket for itself and all following non-section entries until the next
  // section. This lets getActions() interleave page-1 and page-2 content
  // by simply tagging the section header with `page: 2`.
  const buckets = new Map(); // pageNumber -> array of entries
  let currentSectionPage = 1;
  for (const a of actions) {
    if (a.type === "section") currentSectionPage = a.page || 1;
    const target = a.type === "section" ? (a.page || 1) : currentSectionPage;
    if (!buckets.has(target)) buckets.set(target, []);
    buckets.get(target).push(a);
  }
  const pages = [...buckets.keys()].sort((a, b) => a - b);
  ui.pageCount = pages.length;
  if (ui.currentPage > ui.pageCount) ui.currentPage = 1;

  listEl.innerHTML = "";
  const pager = document.createElement("div");
  pager.className = "actions-pager";
  listEl.appendChild(pager);

  ui.pageBounds = [];

  for (const pageNum of pages) {
    const pageEl = document.createElement("div");
    pageEl.className = "actions-page";
    pageEl.dataset.page = String(pageNum);
    pager.appendChild(pageEl);

    const pageStart = ui.items.length;
    let gridContainer = null;
    let columnsContainer = null;
    let currentColumn = null;
    let currentScrollTarget = null; // set when a section is scrollable
    let navigateGrid = null;

    const closeColumns = () => { columnsContainer = null; currentColumn = null; currentScrollTarget = null; };
    const closeNavigateGrid = () => { navigateGrid = null; };

    for (const action of buckets.get(pageNum)) {
      if (action.type === "section") {
        gridContainer = null;
        const header = document.createElement("div");
        header.className = "list-section-header";
        header.textContent = action.label;
        if (action.navigateGrid) {
          closeColumns();
          pageEl.appendChild(header);
          navigateGrid = document.createElement("div");
          navigateGrid.className = "navigate-grid";
          pageEl.appendChild(navigateGrid);
        } else if (action.column) {
          closeNavigateGrid();
          if (!columnsContainer) {
            columnsContainer = document.createElement("div");
            columnsContainer.className = "sections-row";
            pageEl.appendChild(columnsContainer);
          }
          if (action.stack && currentColumn) {
            currentColumn.appendChild(header);
          } else {
            currentColumn = document.createElement("div");
            currentColumn.className = "section-column";
            currentColumn.appendChild(header);
            columnsContainer.appendChild(currentColumn);
            currentScrollTarget = null;
          }

          // If the section opts into scrolling, build a scroll wrapper and
          // a fade-overlay sibling now. Subsequent items in this section are
          // appended into the scroll wrapper (via currentScrollTarget) rather
          // than the column directly. The fade overlay is shown only when
          // there's overflow AND the user isn't already scrolled to bottom.
          if (action.scrollable) {
            currentColumn.classList.add("scrollable-column");
            const scrollEl = document.createElement("div");
            scrollEl.className = "section-scroll";
            currentColumn.appendChild(scrollEl);
            const fadeEl = document.createElement("div");
            fadeEl.className = "section-scroll-fade";
            currentColumn.appendChild(fadeEl);
            currentScrollTarget = scrollEl;
            const colEl = currentColumn;
            const updateFade = () => {
              const overflowing = scrollEl.scrollHeight > scrollEl.clientHeight + 1;
              const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
              colEl.classList.toggle("has-overflow", overflowing && !atBottom);
            };
            scrollEl.addEventListener("scroll", updateFade);
            // Defer until layout settles so scrollHeight is real.
            requestAnimationFrame(updateFade);
          }
        } else {
          closeColumns();
          closeNavigateGrid();
          pageEl.appendChild(header);
        }
        ui.sectionStarts.push(ui.items.length);
        continue;
      }

      if (action.type === "separator") {
        gridContainer = null;
        closeColumns();
        closeNavigateGrid();
        const sep = document.createElement("div");
        sep.className = "list-separator";
        pageEl.appendChild(sep);
        ui.sectionStarts.push(ui.items.length);
        continue;
      }

      if (action.type === "workspaces") {
        gridContainer = null;
        const target = currentScrollTarget || currentColumn || pageEl;
        renderWorkspaceSwitcher(target);
        // Auto-scroll the active workspace into view once layout settles.
        // If the parent is the scrollable wrapper, scrollIntoView on the
        // active row scrolls just that container; otherwise it's a no-op
        // (only matters when the section has scrollable: true).
        requestAnimationFrame(() => {
          const active = target.querySelector(".ws-active");
          if (active) active.scrollIntoView({ block: "nearest" });
        });
        continue;
      }

      if (navigateGrid) {
        const cell = buildNavigateCell(action);
        navigateGrid.appendChild(cell);
        ui.items.push(action);
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
        (currentScrollTarget || currentColumn).appendChild(el);
      } else if (action.compact) {
        if (!gridContainer) {
          gridContainer = document.createElement("div");
          gridContainer.className = "actions-grid";
          pageEl.appendChild(gridContainer);
        }
        gridContainer.appendChild(el);
      } else {
        gridContainer = null;
        closeColumns();
        pageEl.appendChild(el);
      }
      ui.items.push(action);
    }

    ui.pageBounds.push([pageStart, ui.items.length]);
  }

  applyPagerTransformInstant();
  renderPageIndicator();
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
// Build the lightweight preview shape passed into `getActions` for any
// tab-style preview slot (parent, previous, vertical neighbors).
function buildTabPreview(tab) {
  return tab
    ? { title: tab.title, favIconUrl: tab.favIconUrl, domId: tab.domId, workspaceId: tab.workspaceId, pending: tab.pending }
    : null;
}

function resetActionsState() {
  tabState.currentTabHasParent = false;
  tabState.currentTabIsPinned = false;
  tabState.childTabCount = 0;
  tabState.siblingTabCount = 0;
  tabState.parentTabCount = 0;
  tabState.domainCount = 0;
  tabState.unvisitedTabCount = 0;
  tabState.duplicateGroupCount = 0;
  tabState.recentlyClosedCount = 0;
  tabState.navigationHistoryCount = 0;
  tabState.parentTabPreview = null;
  tabState.previousTabPreview = null;
  tabState.backPreview = null;
  tabState.forwardPreview = null;
  tabState.nextVerticalPreview = null;
  tabState.prevVerticalPreview = null;
  tabState.newestUnvisitedPreview = null;
  tabState.oldestUnvisitedPreview = null;
  tabState.selectedTabCount = 0;
  tabState.workspaceTabCounts = {};
}

async function showActionsMenu() {
  ui.currentView = "actions";

  // Run all 5 cross-process fetches in parallel. Each is independent —
  // running them serially burned 3 round-trips of latency on every open.
  let allTabs, closed, navHist, selectedDomIds;
  try {
    [allTabs, closed, navHist, selectedDomIds] = await Promise.all([
      getAllTabsCached(),
      ext.runtime.sendMessage({ type: "get-recently-closed" }).catch(() => []),
      ext.runtime.sendMessage({ type: "get-navigation-history" }).catch(() => null),
      ext.runtime.sendMessage({ type: "get-selected-tab-dom-ids" }).catch(() => []),
      fetchWorkspaceMap(),
    ]);
  } catch (e) {
    resetActionsState();
    if (!initialView) {
      renderActions(getActions(), null);
      hideSidebar();
    }
    return;
  }

  // Single-pass aggregation. The previous code did 11 separate filter / map /
  // sort passes over allTabs. With 500+ tabs each pass allocated an
  // intermediate array; this version makes two passes total — pass 1 finds
  // activeTab and gathers tab-independent metrics, pass 2 computes the
  // metrics that depend on activeTab.

  // ----- Pass 1: tab-independent aggregates -----
  let activeTab = null;
  let unvisitedTabCount = 0;
  let newestUnvisited = null;
  let newestUnvisitedAccess = -Infinity;
  let oldestUnvisited = null;
  let oldestUnvisitedAccess = Infinity;
  const childOpeners = new Set();    // domIds that are someone's parent
  const urlCounts = new Map();
  const domainSet = new Set();
  const workspaceTabCounts = {};

  for (let i = 0; i < allTabs.length; i++) {
    const t = allTabs[i];
    if (t.active) activeTab = t;
    if (t.unread) {
      unvisitedTabCount++;
      const access = t.lastAccessed || 0;
      if (access > newestUnvisitedAccess) {
        newestUnvisitedAccess = access;
        newestUnvisited = t;
      }
      if (access < oldestUnvisitedAccess) {
        oldestUnvisitedAccess = access;
        oldestUnvisited = t;
      }
    }
    if (t.openerTabDomId) childOpeners.add(t.openerTabDomId);
    const url = t.url;
    if (url) {
      const d = extractDomain(url);
      if (d) domainSet.add(d);
      if (url !== "about:newtab" && url !== "about:blank") {
        urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
      }
    }
    if (t.workspaceId) {
      workspaceTabCounts[t.workspaceId] = (workspaceTabCounts[t.workspaceId] || 0) + 1;
    }
  }

  let duplicateGroupCount = 0;
  for (const c of urlCounts.values()) if (c > 1) duplicateGroupCount++;

  // ----- Pass 2: activeTab-dependent aggregates -----
  const activeOpener = activeTab?.openerTabDomId || null;
  const activeWs = activeTab?.workspaceId || null;
  const activeSplitGroupId = activeTab?.splitGroupId || null;
  const activeDomId = activeTab?.domId || null;

  let childTabCount = 0;
  let siblingTabCount = 0;
  let parentTabCount = 0;
  let parentTab = null;
  let prevBest = null;          // most-recently-accessed non-self non-split-sibling non-unread tab
  let prevBestAccess = -Infinity;
  const sameWsTabs = activeWs ? [] : null;
  let vIdx = -1;

  for (let i = 0; i < allTabs.length; i++) {
    const t = allTabs[i];

    if (childOpeners.has(t.domId)) parentTabCount++;

    if (activeTab) {
      if (t.openerTabDomId === activeDomId) childTabCount++;
      if (activeOpener && t.openerTabDomId === activeOpener && t.domId !== activeDomId) siblingTabCount++;
      if (activeOpener && t.domId === activeOpener) parentTab = t;

      if (sameWsTabs && t.workspaceId === activeWs) {
        if (t.domId === activeDomId) vIdx = sameWsTabs.length;
        sameWsTabs.push(t);
      }

      // Previous-tab preview candidate: not active, not split sibling, not unread.
      // Track the running argmax instead of collecting + sorting an intermediate.
      const isActive = t.domId === activeDomId;
      const isSplitSibling = activeSplitGroupId != null && t.splitGroupId === activeSplitGroupId;
      if (!isActive && !isSplitSibling && !t.unread) {
        const access = t.lastAccessed || 0;
        if (access > prevBestAccess) {
          prevBestAccess = access;
          prevBest = t;
        }
      }
    }
  }

  // ----- Write derived state -----
  tabState.currentTabHasParent = !!activeOpener;
  tabState.currentTabIsPinned = !!activeTab?.pinned;
  tabState.childTabCount = childTabCount;
  tabState.siblingTabCount = siblingTabCount;
  tabState.unvisitedTabCount = unvisitedTabCount;
  tabState.parentTabCount = parentTabCount;
  tabState.domainCount = domainSet.size;
  tabState.workspaceTabCounts = workspaceTabCounts;
  tabState.duplicateGroupCount = duplicateGroupCount;
  tabState.recentlyClosedCount = Array.isArray(closed) ? closed.length : 0;
  tabState.selectedTabCount = Array.isArray(selectedDomIds) ? selectedDomIds.length : 0;

  tabState.parentTabPreview = activeOpener ? buildTabPreview(parentTab) : null;
  tabState.previousTabPreview = buildTabPreview(prevBest);
  tabState.newestUnvisitedPreview = buildTabPreview(newestUnvisited);
  // If only one unread tab exists, newest and oldest collapse to the same tab.
  // Hide the oldest preview so the cell shows as disabled rather than echoing
  // the same tab twice.
  tabState.oldestUnvisitedPreview = (oldestUnvisited && oldestUnvisited !== newestUnvisited)
    ? buildTabPreview(oldestUnvisited)
    : null;

  if (activeTab && sameWsTabs) {
    tabState.prevVerticalPreview = vIdx > 0 ? buildTabPreview(sameWsTabs[vIdx - 1]) : null;
    tabState.nextVerticalPreview = vIdx >= 0 && vIdx < sameWsTabs.length - 1
      ? buildTabPreview(sameWsTabs[vIdx + 1])
      : null;
  } else {
    tabState.prevVerticalPreview = null;
    tabState.nextVerticalPreview = null;
  }

  if (navHist && Array.isArray(navHist.entries)) {
    const i = navHist.index;
    tabState.navigationHistoryCount = navHist.entries.length;
    tabState.backPreview = i > 0
      ? { title: navHist.entries[i - 1].title, url: navHist.entries[i - 1].url, isHistory: true }
      : null;
    tabState.forwardPreview = i < navHist.entries.length - 1
      ? { title: navHist.entries[i + 1].title, url: navHist.entries[i + 1].url, isHistory: true }
      : null;
  } else {
    tabState.navigationHistoryCount = 0;
    tabState.backPreview = null;
    tabState.forwardPreview = null;
  }

  if (!initialView) {
    renderActions(getActions(), null);
    hideSidebar();
  }
}
// Render the workspace switcher rows directly into `parent` (the caller is
// responsible for placing parent inside a scroll container if scrolling is
// desired — the actions menu uses the section's .section-scroll wrapper).
// Pushes a synthetic item per workspace into `ui.items` so arrow-key
// navigation reaches them like any other row.
function renderWorkspaceSwitcher(parent) {
  const allWorkspaces = Object.entries(wsState.workspaceMap);
  if (allWorkspaces.length === 0) return;

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

    parent.appendChild(el);

    ui.items.push({
      workspaceSwitchId: uuid,
      label: ws.name,
      isActiveWorkspace: isActive,
    });
  }
}

// View registry
VIEWS["actions"] = () => showActionsMenu();
