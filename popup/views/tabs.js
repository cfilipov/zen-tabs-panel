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

async function showChildTabs(animate) {
  ui.currentView = "child-tabs";

  let allTabs;
  try {
    allTabs = await getAllTabsCached();
  } catch (e) {
    renderTabList([], "Children");
    return;
  }

  const activeTab = allTabs.find((t) => t.active);
  if (!activeTab) {
    renderTabList([], "Children");
    return;
  }

  const children = filterByWorkspace(allTabs.filter((t) =>
    (activeTab.panelTabUuid && t.panelParentUuid === activeTab.panelTabUuid) ||
    (!t.panelParentUuid && t.openerTabDomId === activeTab.domId)
  ));
  renderTabList(children, "Children");
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
  const parents = filterByWorkspace(allTabs.filter((t) =>
    (t.panelTabUuid && parentUuids.has(t.panelTabUuid)) ||
    parentDomIds.has(t.domId)
  ));
  renderTabList(parents, "Parent tabs");
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
VIEWS["child-tabs"]      = () => showChildTabs();
VIEWS["sibling-tabs"]    = () => showSiblingTabs();
VIEWS["parent-tabs"]     = () => showParentTabs();
VIEWS["unvisited-tabs"]  = () => showUnvisitedTabs();
