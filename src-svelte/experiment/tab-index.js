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

  function compactFavicon(url) {
    if (!url) return "";
    const s = String(url);
    if (s.length > 2048) return "";
    return s;
  }

  function compactTabRow(row) {
    return {
      index: row.index,
      id: row.id,
      domId: row.domId,
      title: row.title,
      url: row.url,
      domain: row.domain,
      workspaceId: row.workspaceId,
      pinned: row.pinned,
      essential: row.essential,
      active: row.active,
      lastAccessed: row.lastAccessed,
      favIconUrl: compactFavicon(row.favIconUrl),
      unread: row.unread,
      openerTabDomId: row.openerTabDomId,
      splitView: row.splitView,
      splitGroupId: row.splitGroupId,
      pending: row.pending,
      panelTabUuid: row.panelTabUuid,
      panelParentUuid: row.panelParentUuid,
      focusCount: row.focusCount,
    };
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
    let out = rows;
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
    getWorkspaceTabCounts() {
      rebuildIfNeeded();
      const counts = Object.create(null);
      for (const row of rows) {
        if (!row.workspaceId) continue;
        counts[row.workspaceId] = (counts[row.workspaceId] || 0) + 1;
      }
      return counts;
    },
  };
};
