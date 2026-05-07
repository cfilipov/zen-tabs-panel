"use strict";

// Tab list views (children, siblings, parent tabs, unvisited)
//
// Loaded as <script src="views/tabs.js"> from popup.html. Cross-file
// references (ui/tabState/wsState, DOM refs, render.js helpers, popup.js
// helpers, shared/dom-utils.js) resolve via the shared script-global scope.

async function showChildTabs(animate) {
  ui.currentView = "child-tabs";

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
  ui.currentView = "sibling-tabs";

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
  ui.currentView = "parent-tabs";

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
async function showUnvisitedTabs(animate) {
  ui.currentView = "unvisited";

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

// View registry
VIEWS["child-tabs"]      = () => showChildTabs();
VIEWS["sibling-tabs"]    = () => showSiblingTabs();
VIEWS["parent-tabs"]     = () => showParentTabs();
VIEWS["unvisited-tabs"]  = () => showUnvisitedTabs();
