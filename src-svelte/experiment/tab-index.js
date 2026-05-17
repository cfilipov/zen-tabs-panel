"use strict";

// Chrome-scope tab index for the Svelte migration. It keeps rich tab DOM
// access in experiment/api.js and exposes small, windowed DTOs across the
// WebExtension boundary. This file is loaded with Services.scriptloader.

this.createZenTabIndex = function createZenTabIndex(deps) {
  let started = false;
  let dirty = true;
  let version = 0;
  let rows = [];
  let byDomId = new Map();
  let mutationObserver = null;

  function markDirty() {
    dirty = true;
    version++;
  }

  function domainOf(url) {
    const match = String(url || "").match(/^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i);
    return match ? match[1].replace(/^www\./, "") : "";
  }

  function isNewTabUrl(url) {
    return !url || url === "about:newtab" || url === "about:blank" || url === "about:home";
  }

  function isDisplayTabRow(row) {
    return row && !isNewTabUrl(row.url);
  }

  function compactFavicon(url) {
    if (!url) return "";
    const s = String(url);
    if (s.length > 2048) return "";
    return s;
  }

  function compactTabRow(row) {
    return {
      index: row.index,
      domId: row.domId,
      title: row.title,
      domain: row.domain,
      workspaceId: row.workspaceId,
      pinned: row.pinned,
      essential: row.essential,
      active: row.active,
      favIconUrl: compactFavicon(row.favIconUrl),
      pending: row.pending,
      focusCount: row.focusCount,
    };
  }

  function previewRow(row) {
    return row
      ? {
          title: row.title,
          url: row.url,
          favIconUrl: compactFavicon(row.favIconUrl),
          domId: row.domId,
          workspaceId: row.workspaceId,
          pending: row.pending,
          pinned: row.pinned,
          essential: row.essential,
        }
      : null;
  }

  function splitGroupMap(win) {
    const out = new Map();
    if (!win?.gZenViewSplitter?._data) return out;
    for (const group of win.gZenViewSplitter._data) {
      if (!group.tabs) continue;
      for (const tab of group.tabs) {
        out.set(tab.id, group.groupId);
      }
    }
    return out;
  }

  function readRow(tab, index, tabToGroupId) {
    const panelStats = deps.readTabStats(tab);
    return {
      index,
      id: deps.getExtTabId(tab),
      domId: tab.id,
      title: tab.label || "",
      url: tab.linkedBrowser?.currentURI?.spec || "",
      domain: domainOf(tab.linkedBrowser?.currentURI?.spec || ""),
      workspaceId: tab.getAttribute("zen-workspace-id") || null,
      pinned: tab.pinned || false,
      essential: tab.hasAttribute("zen-essential"),
      active: tab.selected || false,
      lastAccessed: tab.lastAccessed || 0,
      favIconUrl: deps.unwrapFavicon(tab.image),
      unread: tab.hasAttribute("unread") || deps.readTabValue(tab, "panelUnread") === true,
      openerTabDomId: tab.openerTab?.id || null,
      splitView: tab.hasAttribute("split-view"),
      splitGroupId: tabToGroupId.get(tab.id) || null,
      pending: tab.hasAttribute("pending"),
      panelTabUuid: deps.ensureTabUuid(tab),
      panelParentUuid: deps.readTabValue(tab, "panelParentUuid") || null,
      panelStats,
      focusCount: (panelStats && panelStats.focusCount) || 0,
    };
  }

  function rebuildIfNeeded() {
    start();
    if (!dirty) return;
    try { deps.recordInterval(); } catch (e) {}
    const win = deps.getWin();
    const tabToGroupId = splitGroupMap(win);
    rows = deps.getAllTabElements().map((tab, index) => readRow(tab, index, tabToGroupId));
    byDomId = new Map(rows.map((row) => [row.domId, row]));
    dirty = false;
  }

  function filteredRows(view, params) {
    rebuildIfNeeded();
    let out = rows.filter(isDisplayTabRow);
    if (params?.workspaceId && params.workspaceId !== "all") {
      out = out.filter((row) => row.workspaceId === params.workspaceId);
    }
    if (view === "domain-tabs" && params?.domain) {
      out = out.filter((row) => row.domain === params.domain);
    }
    if (view === "child-tabs") {
      const anchor = params?.parentDomId
        ? rows.find((row) => row.domId === params.parentDomId)
        : rows.find((row) => row.active);
      out = anchor ? childrenOfParent(out, anchor) : [];
    }
    if (view === "sibling-tabs") {
      const active = rows.find((row) => row.active);
      out = active ? siblingsOf(active, out) : [];
    }
    if (view === "parent-tabs") {
      out = parentRows(out);
    }
    if (view === "unvisited-tabs") {
      out = out.filter((row) => row.unread);
    }
    if (view === "last-visited") {
      const active = rows.find((row) => row.active) || null;
      const activeSplitGroupId = active?.splitGroupId || null;
      const activeDomId = active?.domId || null;
      out = out.filter((row) => {
        if (row.domId === activeDomId) return false;
        if (activeSplitGroupId && row.splitGroupId === activeSplitGroupId) return false;
        if (row.unread) return false;
        return true;
      });
    }
    if (view === "last-visited" || view === "domain-tabs" || view === "unvisited-tabs") {
      out = [...out].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    } else if (view === "tabs-by-age") {
      const createdAt = (row) => Number.parseInt(String(row.domId || "").split("-")[0], 10) || 0;
      out = [...out].sort(params?.newestFirst
        ? (a, b) => createdAt(b) - createdAt(a)
        : (a, b) => createdAt(a) - createdAt(b));
    } else if (view === "most-visited") {
      out = out
        .filter((row) => row.url && !String(row.url).startsWith("about:"))
        .sort((a, b) => (b.focusCount || 0) - (a.focusCount || 0));
    }
    return out;
  }

  function childrenOfParent(sourceRows, parent) {
    return sourceRows.filter((row) =>
      (parent.panelTabUuid && row.panelParentUuid === parent.panelTabUuid) ||
      (!row.panelParentUuid && row.openerTabDomId === parent.domId)
    );
  }

  function siblingsOf(active, sourceRows) {
    const hasUuidParent = !!active.panelParentUuid;
    const hasDomOpener = !!active.openerTabDomId;
    if (!hasUuidParent && !hasDomOpener) return [];
    return sourceRows.filter((row) => {
      if (row.panelTabUuid && active.panelTabUuid && row.panelTabUuid === active.panelTabUuid) return false;
      if (row.domId === active.domId) return false;
      if (hasUuidParent && row.panelParentUuid === active.panelParentUuid) return true;
      if (!row.panelParentUuid && hasDomOpener && row.openerTabDomId === active.openerTabDomId) return true;
      return false;
    });
  }

  function parentRows(sourceRows) {
    const parentUuids = new Set();
    const parentDomIds = new Set();
    for (const row of sourceRows) {
      if (row.panelParentUuid) parentUuids.add(row.panelParentUuid);
      else if (row.openerTabDomId) parentDomIds.add(row.openerTabDomId);
    }
    return sourceRows.filter((row) => {
      const isParent = (row.panelTabUuid && parentUuids.has(row.panelTabUuid)) || parentDomIds.has(row.domId);
      return isParent && childrenOfParent(sourceRows, row).length > 0;
    });
  }

  function domainRows(params) {
    const counts = new Map();
    for (const row of filteredRows("all", params)) {
      const domain = row.domain;
      if (!domain) continue;
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([domain, count]) => ({ kind: "domain", domain, count }))
      .sort(params?.sortAlpha
        ? (a, b) => a.domain.localeCompare(b.domain)
        : (a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
  }

  function duplicateGroups(params) {
    const groups = new Map();
    for (const row of filteredRows("all", params)) {
      const group = groups.get(row.url);
      if (group) group.push(row);
      else groups.set(row.url, [row]);
    }
    return [...groups.values()]
      .filter((group) => group.length > 1)
      .sort((a, b) => b.length - a.length)
      .map((tabs) => {
        const sample = tabs[0];
        return {
          kind: "duplicate-group",
          url: sample.url,
          title: sample.title,
          domain: sample.domain || domainOf(sample.url),
          favIconUrl: compactFavicon(sample.favIconUrl),
          tabs: tabs.map(compactTabRow),
        };
      });
  }

  function rowsForView(view, params) {
    if (view === "domains") return domainRows(params);
    return filteredRows(view, params);
  }

  function start() {
    if (started) return;
    started = true;
    const win = deps.getWin();
    const container = win?.gBrowser?.tabContainer;
    if (container) {
      for (const name of ["TabOpen", "TabClose", "TabMove", "TabSelect", "TabAttrModified"]) {
        container.addEventListener(name, markDirty, true);
      }
      mutationObserver = new win.MutationObserver(markDirty);
      mutationObserver.observe(container, {
        subtree: true,
        attributes: true,
        attributeFilter: ["label", "image", "unread", "selected", "visuallyselected", "zen-workspace-id", "pending"],
      });
    }
    try {
      win?.gZenWorkspaces?.addChangeListener?.(markDirty);
      win?.gZenWorkspaces?.addChangeListeners?.(markDirty);
    } catch (e) {}
  }

  function stop() {
    const win = deps.getWin();
    const container = win?.gBrowser?.tabContainer;
    if (container) {
      for (const name of ["TabOpen", "TabClose", "TabMove", "TabSelect", "TabAttrModified"]) {
        container.removeEventListener(name, markDirty, true);
      }
    }
    try { mutationObserver?.disconnect(); } catch (e) {}
    mutationObserver = null;
    started = false;
  }

  return {
    start,
    stop,
    markDirty,
    getVersion() {
      rebuildIfNeeded();
      return version;
    },
    getSummary(view, params) {
      const viewRows = rowsForView(view || "all", params || {});
      return {
        version,
        view: view || "all",
        total: viewRows.length,
        rowType: view === "domains" ? "domain" : "tab",
      };
    },
    getWindow(view, offset, limit, params) {
      const viewRows = rowsForView(view || "all", params || {});
      const start = Math.max(0, Number(offset) || 0);
      const size = Math.max(0, Math.min(Number(limit) || 50, 200));
      return {
        version,
        view: view || "all",
        offset: start,
        limit: size,
        total: viewRows.length,
        rows: viewRows.slice(start, start + size).map((row) => row.kind === "domain" ? row : compactTabRow(row)),
      };
    },
    getRowTarget(domId) {
      rebuildIfNeeded();
      const row = byDomId.get(domId);
      return row ? { domId: row.domId, workspaceId: row.workspaceId, url: row.url, title: row.title } : null;
    },
    getActiveRow() {
      rebuildIfNeeded();
      const row = rows.find((candidate) => candidate.active);
      return row ? compactTabRow(row) : null;
    },
    getRowsByDomIds(domIds) {
      rebuildIfNeeded();
      const ids = Array.isArray(domIds) ? domIds : [];
      return ids
        .map((domId) => byDomId.get(domId))
        .filter(Boolean)
        .map(compactTabRow);
    },
    getAutoCloseCandidates(cutoffMs) {
      rebuildIfNeeded();
      const cutoff = Number(cutoffMs) || 0;
      return rows
        .filter((row) => !row.pinned && !row.active && (row.lastAccessed || 0) < cutoff)
        .map((row) => ({
          domId: row.domId,
          id: row.id,
          lastAccessed: row.lastAccessed,
          workspaceId: row.workspaceId,
        }));
    },
    getWorkspaceTabCounts() {
      rebuildIfNeeded();
      const counts = Object.create(null);
      for (const row of rows) {
        if (!row.workspaceId) continue;
        counts[row.workspaceId] = (counts[row.workspaceId] || 0) + 1;
      }
      return counts;
    },
    getDuplicateGroups(params) {
      return duplicateGroups(params || {});
    },
    getActionsSnapshot() {
      rebuildIfNeeded();
      const activeTab = rows.find((row) => row.active) || null;
      const activeParentUuid = activeTab?.panelParentUuid || null;
      const activeOpener = activeTab?.openerTabDomId || null;
      const activeUuid = activeTab?.panelTabUuid || null;
      const activeWorkspaceId = activeTab?.workspaceId || null;
      const activeSplitGroupId = activeTab?.splitGroupId || null;
      const activeDomId = activeTab?.domId || null;
      const hasParent = !!(activeParentUuid || activeOpener);

      let parentTab = null;
      const parentUuids = new Set();
      const parentDomIds = new Set();
      const uuidToRow = new Map();
      const urlCounts = new Map();
      const domains = new Set();
      const workspaceTabCounts = Object.create(null);
      let unvisitedTabCount = 0;
      let newestUnvisited = null;
      let newestUnvisitedAccess = -Infinity;
      let oldestUnvisited = null;
      let oldestUnvisitedAccess = Infinity;
      const displayRows = rows.filter(isDisplayTabRow);

      for (const row of displayRows) {
        if (row.panelTabUuid) uuidToRow.set(row.panelTabUuid, row);
        if (row.panelParentUuid) parentUuids.add(row.panelParentUuid);
        else if (row.openerTabDomId) parentDomIds.add(row.openerTabDomId);
        if (row.workspaceId) workspaceTabCounts[row.workspaceId] = (workspaceTabCounts[row.workspaceId] || 0) + 1;
        if (row.domain) domains.add(row.domain);
        urlCounts.set(row.url, (urlCounts.get(row.url) || 0) + 1);
        if (row.unread) {
          unvisitedTabCount++;
          const access = row.lastAccessed || 0;
          if (access > newestUnvisitedAccess) {
            newestUnvisitedAccess = access;
            newestUnvisited = row;
          }
          if (access < oldestUnvisitedAccess) {
            oldestUnvisitedAccess = access;
            oldestUnvisited = row;
          }
        }
      }

      if (activeParentUuid) parentTab = uuidToRow.get(activeParentUuid) || null;
      if (!parentTab && activeOpener) parentTab = displayRows.find((row) => row.domId === activeOpener) || null;

      let childTabCount = 0;
      let siblingTabCount = 0;
      let parentTabCount = 0;
      let prevBest = null;
      let prevBestAccess = -Infinity;
      const sameWorkspaceTabs = activeWorkspaceId ? [] : null;
      let verticalIndex = -1;

      for (const row of displayRows) {
        if ((row.panelTabUuid && parentUuids.has(row.panelTabUuid)) || parentDomIds.has(row.domId)) {
          parentTabCount++;
        }

        if (!activeTab) continue;

        const isChildByUuid = activeUuid && row.panelParentUuid === activeUuid;
        const isChildByDom = !row.panelParentUuid && row.openerTabDomId === activeDomId;
        if (isChildByUuid || isChildByDom) childTabCount++;

        const isSiblingByUuid = activeParentUuid && row.panelParentUuid === activeParentUuid && row.domId !== activeDomId;
        const isSiblingByDom = !activeParentUuid && !row.panelParentUuid && activeOpener && row.openerTabDomId === activeOpener && row.domId !== activeDomId;
        if (isSiblingByUuid || isSiblingByDom) siblingTabCount++;

        if (sameWorkspaceTabs && row.workspaceId === activeWorkspaceId) {
          if (row.domId === activeDomId) verticalIndex = sameWorkspaceTabs.length;
          sameWorkspaceTabs.push(row);
        }

        const isActive = row.domId === activeDomId;
        const isSplitSibling = activeSplitGroupId != null && row.splitGroupId === activeSplitGroupId;
        if (!isActive && !isSplitSibling && !row.unread) {
          const access = row.lastAccessed || 0;
          if (access > prevBestAccess) {
            prevBestAccess = access;
            prevBest = row;
          }
        }
      }

      let duplicateGroupCount = 0;
      for (const count of urlCounts.values()) if (count > 1) duplicateGroupCount++;

      const prevVertical = sameWorkspaceTabs && verticalIndex > 0 ? sameWorkspaceTabs[verticalIndex - 1] : null;
      const nextVertical = sameWorkspaceTabs && verticalIndex >= 0 && verticalIndex < sameWorkspaceTabs.length - 1
        ? sameWorkspaceTabs[verticalIndex + 1]
        : null;
      const oldestDistinct = oldestUnvisited && oldestUnvisited !== newestUnvisited ? oldestUnvisited : null;

      return {
        version,
        currentTabHasParent: hasParent,
        currentTabIsPinned: !!activeTab?.pinned,
        childTabCount,
        siblingTabCount,
        parentTabCount,
        unvisitedTabCount,
        domainCount: domains.size,
        duplicateGroupCount,
        workspaceTabCounts,
        previews: {
          "go-to-previous-tab": previewRow(prevBest),
          "go-to-parent-tab": previewRow(parentTab),
          "go-to-prev-vertical-tab": previewRow(prevVertical),
          "go-to-next-vertical-tab": previewRow(nextVertical),
          "unvisited-newest": previewRow(newestUnvisited),
          "unvisited-oldest": previewRow(oldestDistinct),
        },
      };
    },
  };
};
