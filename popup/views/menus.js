"use strict";

// Quick-menu submenus (reorder, split, close-and-select)
//
// Loaded as <script src="views/menus.js"> from popup.html. Cross-file
// references (ui/tabState/wsState, DOM refs, render.js helpers, popup.js
// helpers, shared/dom-utils.js) resolve via the shared script-global scope.

function showReorderTabs() {
  ui.currentView = "reorder-tabs";
  ui.sectionStarts = [0];

  const reorderOptions = kbChildrenOf("reorder-tabs").map((c) => ({
    label: c.label,
    hotkey: c.chord,
    icon: c.icon,
    reorderAction: c.id,
  }));

  ui.items = reorderOptions;
  ui.selectedIndex = -1;
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
function showSplitView() {
  ui.currentView = "split-view";
  ui.sectionStarts = [0];

  const opts = kbChildrenOf("split-view").map((c) => ({
    label: c.label,
    hotkey: c.chord,
    icon: c.icon,
    submenuAction: c.id,
  }));

  ui.items = opts;
  ui.selectedIndex = -1;
  listEl.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "actions-grid actions-grid-2col";

  for (const opt of opts) {
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
      ext.runtime.sendMessage({ type: opt.submenuAction }).catch(() => {});
    });

    grid.appendChild(el);
  }

  listEl.appendChild(grid);
  updateSelection();
  updateHeader("Split");
}
async function showCloseAndSelect() {
  ui.currentView = "close-and-select";
  ui.sectionStarts = [0];

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

  if (!wsState.workspaceMap || Object.keys(wsState.workspaceMap).length === 0) {
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
  const nextVerticalLocal = (vIdx >= 0 && vIdx < wsTabs.length - 1) ? buildPreview(wsTabs[vIdx + 1]) : null;
  const prevVerticalLocal = (vIdx > 0) ? buildPreview(wsTabs[vIdx - 1]) : null;

  const defaultPreview = defaultCloseTargetDomId
    ? buildPreview(allTabs.find((t) => t.domId === defaultCloseTargetDomId))
    : null;

  const previewByActionId = {
    "close-and-select-default":       defaultPreview,
    "close-and-select-previous":      previousPreview,
    "close-and-select-parent":        parentPreview,
    "close-and-select-next-sibling":  nextSiblingPreview,
    "close-and-select-prev-sibling":  prevSiblingPreview,
    "close-and-select-next-vertical": nextVerticalLocal,
    "close-and-select-prev-vertical": prevVerticalLocal,
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

  ui.items = options;
  ui.selectedIndex = -1;
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
      if (opt.preview.workspaceId && opt.preview.workspaceId !== wsState.activeWorkspaceId) {
        const ws = wsState.workspaceMap[opt.preview.workspaceId];
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

// View registry
VIEWS["reorder-tabs"]      = () => showReorderTabs();
VIEWS["split-view"]        = () => showSplitView();
VIEWS["close-and-select"]  = () => showCloseAndSelect();
