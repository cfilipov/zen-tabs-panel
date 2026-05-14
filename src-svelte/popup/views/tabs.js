"use strict";

// Tab list views (children, siblings, parent tabs, unvisited)
//
// Loaded as <script src="views/tabs.js"> from popup.html. Cross-file
// references (ui/tabState/wsState, DOM refs, render.js helpers, popup.js
// helpers, shared/dom-utils.js) resolve via the shared script-global scope.

// Parent-child relationships are persisted via panelTabUuid / panelParentUuid
// (see experiment/api.js). Tab DOM ids regenerate on browser restart, but
// UUIDs ride along in SessionStore extData. We fall back to openerTabDomId for
// transitional safety on tabs the new persistence layer hasn't stamped yet.

// Compute the in-workspace children of a given parent tab. Used both for
// the drill-down view and for the "N children" pill rendered on parent rows.
function childrenOfParent(allTabs, parent) {
  return filterByWorkspace(allTabs.filter((t) =>
    (parent.panelTabUuid && t.panelParentUuid === parent.panelTabUuid) ||
    (!t.panelParentUuid && t.openerTabDomId === parent.domId)
  ));
}

async function showChildTabs(params) {
  ui.currentView = "child-tabs";

  // params === undefined is the refresh path (e.g. workspace filter toggle,
  // close-all-in-view) — keep the drilled parent. A defined params object
  // means fresh navigation: stash parentDomId for the next refresh, or
  // clear it so Shift+C reverts to active-tab semantics.
  let parentDomId;
  if (params === undefined) {
    parentDomId = tabState.childParentDomId;
  } else {
    parentDomId = params.parentDomId || null;
    tabState.childParentDomId = parentDomId;
  }

  let allTabs;
  try {
    allTabs = await getAllTabsCached();
  } catch (e) {
    renderTabList([], "Children");
    return;
  }

  let anchor = null;
  let title = "Children";
  if (parentDomId) {
    anchor = allTabs.find((t) => t.domId === parentDomId);
    if (anchor) title = `Children of ${anchor.title || "Untitled"}`;
  }
  if (!anchor) anchor = allTabs.find((t) => t.active);
  if (!anchor) {
    renderTabList([], title);
    return;
  }

  renderTabList(childrenOfParent(allTabs, anchor), title);
  renderSidebar();
}

async function showSiblingTabs(animate) {
  ui.currentView = "sibling-tabs";

  let allTabs;
  try {
    allTabs = await getAllTabsCached();
  } catch (e) {
    renderTabList([], "Siblings");
    return;
  }

  const activeTab = allTabs.find((t) => t.active);
  if (!activeTab) {
    renderTabList([], "Siblings");
    return;
  }
  const hasUuidParent = !!activeTab.panelParentUuid;
  const hasDomOpener = !!activeTab.openerTabDomId;
  if (!hasUuidParent && !hasDomOpener) {
    renderTabList([], "Siblings");
    return;
  }

  const siblings = filterByWorkspace(allTabs.filter((t) => {
    if (t.panelTabUuid && activeTab.panelTabUuid && t.panelTabUuid === activeTab.panelTabUuid) return false;
    if (t.domId === activeTab.domId) return false;
    if (hasUuidParent && t.panelParentUuid === activeTab.panelParentUuid) return true;
    if (!t.panelParentUuid && hasDomOpener && t.openerTabDomId === activeTab.openerTabDomId) return true;
    return false;
  }));
  renderTabList(siblings, "Siblings");
  renderSidebar();
}

async function showParentTabs(animate) {
  ui.currentView = "parent-tabs";

  let allTabs;
  try {
    allTabs = await getAllTabsCached();
  } catch (e) {
    renderTabList([], "Parent tabs");
    return;
  }

  const parentUuids = new Set();
  const parentDomIds = new Set();
  for (const t of allTabs) {
    if (t.panelParentUuid) parentUuids.add(t.panelParentUuid);
    else if (t.openerTabDomId) parentDomIds.add(t.openerTabDomId);
  }
  const allParents = filterByWorkspace(allTabs.filter((t) =>
    (t.panelTabUuid && parentUuids.has(t.panelTabUuid)) ||
    parentDomIds.has(t.domId)
  ));

  // A parent referenced cross-workspace may have zero in-workspace children;
  // hiding those keeps the visible count honest against the drill view.
  const childCounts = new Map();
  const parents = [];
  for (const p of allParents) {
    const count = childrenOfParent(allTabs, p).length;
    if (count === 0) continue;
    childCounts.set(p.domId, count);
    parents.push(p);
  }

  renderTabList(parents, "Parent tabs", null, {
    subtitleSuffix: (tab) => {
      const n = childCounts.get(tab.domId) || 0;
      return `<span class="subtitle-pill subtitle-children" data-action="drill-children">${n} ${n === 1 ? "child" : "children"}</span>`;
    },
  });
  renderSidebar();
}
async function showUnvisitedTabs(animate) {
  ui.currentView = "unvisited";

  let allTabs;
  try {
    allTabs = await getAllTabsCached();
  } catch (e) {
    renderTabList([], "New tabs");
    return;
  }

  const unvisited = filterByWorkspace(allTabs.filter((t) => t.unread));
  renderTabList(unvisited, "New tabs");
  renderSidebar();
}

// View registry
VIEWS["child-tabs"]      = (params) => showChildTabs(params);
VIEWS["sibling-tabs"]    = () => showSiblingTabs();
VIEWS["parent-tabs"]     = () => showParentTabs();
VIEWS["unvisited-tabs"]  = () => showUnvisitedTabs();
