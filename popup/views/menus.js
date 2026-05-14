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

  // Single-column list (matches the move-to-folder / new-container-tab
  // layout). Four entries don't need a two-column grid and the narrower
  // width feels less like wasted whitespace.
  for (const opt of opts) {
    const el = document.createElement("div");
    el.className = "list-item";

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

    listEl.appendChild(el);
  }

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
      getAllTabsCached(),
      ext.runtime.sendMessage({ type: "get-default-close-target" }).catch(() => null),
    ]);
    activeTab = allTabs.find((t) => t.active);
  } catch (e) {}

  // Bail if a newer WarmRearm took over mid-fetch — see the matching
  // guard in showActionsMenu / showLastVisited. Without this our paint
  // would clobber listEl, and a dispatched chord-key would scan stale
  // rows (or rows for the wrong view entirely).
  if (ui.currentView !== "close-and-select") return;

  if (!wsState.workspaceMap || Object.keys(wsState.workspaceMap).length === 0) {
    await fetchWorkspaceMap();
    if (ui.currentView !== "close-and-select") return;
  }

  const buildPreview = (tab) => tab
    ? { title: tab.title, favIconUrl: tab.favIconUrl, domId: tab.domId, workspaceId: tab.workspaceId, pending: tab.pending, pinned: tab.pinned, essential: tab.essential }
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

  // Newest / oldest unvisited (across all workspaces, by lastAccessed). Skip
  // the active tab so closing-and-jumping never targets the tab being closed.
  const unread = allTabs.filter((t) => t.unread && t.domId !== activeTab?.domId);
  let newestUnread = null, newestAccess = -Infinity;
  let oldestUnread = null, oldestAccess = Infinity;
  for (const t of unread) {
    const a = t.lastAccessed || 0;
    if (a > newestAccess) { newestAccess = a; newestUnread = t; }
    if (a < oldestAccess) { oldestAccess = a; oldestUnread = t; }
  }
  const newestUnreadPreview = buildPreview(newestUnread);
  const oldestUnreadPreview = (oldestUnread && oldestUnread !== newestUnread)
    ? buildPreview(oldestUnread)
    : null;

  const defaultPreview = defaultCloseTargetDomId
    ? buildPreview(allTabs.find((t) => t.domId === defaultCloseTargetDomId))
    : null;

  const previewByActionId = {
    "close-and-select-default":           defaultPreview,
    "close-and-select-previous":          previousPreview,
    "close-and-select-parent":            parentPreview,
    "close-and-select-next-sibling":      nextSiblingPreview,
    "close-and-select-prev-sibling":      prevSiblingPreview,
    "close-and-select-next-vertical":     nextVerticalLocal,
    "close-and-select-prev-vertical":     prevVerticalLocal,
    "close-and-select-unvisited-newest":  newestUnreadPreview,
    "close-and-select-unvisited-oldest":  oldestUnreadPreview,
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
      const prevFav = extractFavicon(opt.preview.favIconUrl);
      const iconHtml = prevFav
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
      const indicatorHtml = renderTabIndicators(opt.preview);
      previewHtml = `<span class="action-preview${pendingCls}">${iconHtml}<span class="preview-title">${indicatorHtml}${previewTitle}</span>${wsLabel}</span>`;
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

// Move-to-folder: list Zen tab-group folders. Selecting one moves the
// active tab into that group.
async function showMoveToFolder() {
  ui.currentView = "move-to-folder";
  ui.sectionStarts = [0];

  let folders = [];
  try { folders = await ext.runtime.sendMessage({ type: "get-folders" }) || []; }
  catch (e) {}

  if (ui.currentView !== "move-to-folder") return;

  ui.items = folders.map((f) => ({ folderId: f.id, label: f.name, workspaceId: f.workspaceId }));
  ui.selectedIndex = -1;
  listEl.innerHTML = "";

  if (folders.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No folders</div>`;
    updateHeader("Move to folder");
    return;
  }

  for (let i = 0; i < folders.length; i++) {
    const f = folders[i];
    const badge = i + 1 <= 9 ? String(i + 1) : null;
    const wsLabel = f.workspaceId && f.workspaceId !== wsState.activeWorkspaceId
      ? `<span class="row-workspace">${escapeHtml(wsState.workspaceMap[f.workspaceId]?.name || "")}</span>`
      : "";

    const el = document.createElement("div");
    el.className = "list-item";
    el.dataset.folderId = f.id;
    el.innerHTML = `
      <span class="item-icon-placeholder">${getIcon("svg:folder")}</span>
      <span class="item-text"><span class="item-title">${escapeHtml(f.name)}</span></span>
      <span class="item-right">${wsLabel}${badge ? renderBadge(badge) : ""}</span>
    `;
    el.addEventListener("click", () => {
      ext.runtime.sendMessage({ type: "move-tab-to-folder", folderId: f.id }).catch(() => {});
    });
    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader("Move to folder");
}

// Open-in-container: list the user's contextual identities (containers).
// Selecting one reopens the active tab in that container.
async function showOpenInContainer() {
  ui.currentView = "open-in-container";
  ui.sectionStarts = [0];

  let identities = [];
  try { identities = await ext.contextualIdentities.query({}) || []; }
  catch (e) {}

  if (ui.currentView !== "open-in-container") return;

  ui.items = identities.map((c) => ({ userContextId: c.cookieStoreId, label: c.name }));
  ui.selectedIndex = -1;
  listEl.innerHTML = "";

  if (identities.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No containers configured</div>`;
    updateHeader("New container tab");
    return;
  }

  for (let i = 0; i < identities.length; i++) {
    const c = identities[i];
    const badge = i + 1 <= 9 ? String(i + 1) : null;
    // cookieStoreId is "firefox-container-N"; extract the int for userContextId.
    const m = /^firefox-container-(\d+)$/.exec(c.cookieStoreId || "");
    const userContextId = m ? parseInt(m[1], 10) : 0;

    // Firefox ships container icons as black SVGs at resource://usercontext-
    // content/<icon>.svg. We tint them by using the SVG as a CSS mask on a
    // span whose background is the container's colorCode — that way the icon
    // matches what Zen shows in the tab strip.
    const color = c.colorCode || "currentColor";
    const iconUrl = c.iconUrl || "";
    const iconHtml = iconUrl
      ? `<span class="container-icon" style="background-color:${escapeAttr(color)};mask-image:url(${escapeAttr(iconUrl)});-webkit-mask-image:url(${escapeAttr(iconUrl)})"></span>`
      : `<span class="item-icon-placeholder"></span>`;

    const el = document.createElement("div");
    el.className = "list-item";
    el.dataset.userContextId = String(userContextId);
    el.innerHTML = `
      ${iconHtml}
      <span class="item-text"><span class="item-title">${escapeHtml(c.name)}</span></span>
      <span class="item-right">${badge ? renderBadge(badge) : ""}</span>
    `;
    el.addEventListener("click", () => {
      ext.runtime.sendMessage({ type: "reopen-in-container", userContextId }).catch(() => {});
    });
    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader("New container tab");
}

// Profiles submenu: one row per installed Zen profile. The current
// profile is shown disabled with a "Current" badge; activating another
// row spawns a new Zen instance against that profile (via
// launch-profile in background.js → api.launchProfile).
async function showProfiles() {
  ui.currentView = "profiles";
  ui.sectionStarts = [0];
  ui.items = [];
  ui.selectedIndex = -1;

  await fetchProfileList();
  if (ui.currentView !== "profiles") return;
  listEl.innerHTML = "";
  const profiles = profileState.profileList;

  if (!profiles || profiles.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No profiles found</div>`;
    updateHeader("Profiles");
    return;
  }

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const badge = (i + 1) <= 9 ? String(i + 1) : null;

    const el = document.createElement("div");
    el.className = "list-item" + (profile.isCurrent ? " disabled" : "");
    el.dataset.profileName = profile.name;

    let badgeRight = "";
    if (profile.isCurrent) {
      badgeRight = `<span class="item-badge">Current</span>`;
    } else if (profile.isDefault) {
      badgeRight = `<span class="item-badge">Default</span>`;
    }

    el.innerHTML = `
      <span class="item-icon-placeholder">${getIcon("svg:user")}</span>
      <span class="item-text">
        <span class="item-title">${escapeHtml(profile.name)}</span>
      </span>
      <span class="item-right">
        ${badgeRight}
        ${badge !== null && !profile.isCurrent ? renderBadge(badge) : ""}
      </span>
    `;

    if (!profile.isCurrent) {
      el.addEventListener("click", () => {
        ext.runtime.sendMessage({ type: "launch-profile", name: profile.name }).catch(() => {});
      });
    }
    listEl.appendChild(el);

    ui.items.push({
      launchProfileName: profile.isCurrent ? null : profile.name,
      label: profile.name,
      isCurrentProfile: profile.isCurrent,
    });
  }

  updateSelection();
  updateHeader("Profiles");
}

// Duplicate-prompt view: pops up when openLinkIn is about to navigate
// to or open a URL that already matches another open tab. Offers
// Switch (activate existing), Open anyway (run the original
// openLinkIn), or Escape to cancel. params: { url }.
function showDuplicatePrompt(params) {
  ui.currentView = "duplicate-prompt";
  ui.sectionStarts = [0];
  ui.items = [];
  ui.selectedIndex = -1;
  listEl.innerHTML = "";

  // Page-indicator and sidebar are pulled in from the actions menu when
  // this view comes up directly (we open the overlay at duplicate-prompt
  // without going through navigateToView). Hide both explicitly since
  // this is a focused prompt, not a paged list.
  const indicator = document.getElementById("page-indicator");
  if (indicator) indicator.classList.add("hidden");
  if (typeof hideSidebar === "function") hideSidebar();

  const url = (params && typeof params.url === "string") ? params.url : "";
  const existingDomId = (params && typeof params.domId === "string") ? params.domId : null;

  // URL preview at the top.
  const urlRow = document.createElement("div");
  urlRow.className = "duplicate-prompt-url";
  urlRow.textContent = url;
  listEl.appendChild(urlRow);

  // Switch attaches data-dom-id so the standard hover delegate +
  // updateSelection's preview branch (see popup.js) outline the
  // existing duplicate tab in Zen's vertical sidebar — same UX as
  // hovering rows in any tab-list view. The other two rows have no
  // tab association.
  const options = [
    { label: "Switch to existing tab", hotkey: "S", actionId: "duplicate-switch",      icon: "svg:arrow-right", domId: existingDomId },
    { label: "Open anyway",            hotkey: "O", actionId: "duplicate-open-anyway", icon: "svg:plus" },
    { label: "Cancel",                 hotkey: "C", actionId: "hide-palette",          icon: "svg:x-circle" },
  ];

  for (const opt of options) {
    const el = document.createElement("div");
    el.className = "list-item";
    if (opt.domId) el.dataset.domId = opt.domId;
    el.innerHTML = `
      <span class="item-icon-placeholder">${getIcon(opt.icon)}</span>
      <span class="item-text">
        <span class="item-title">${escapeHtml(opt.label)}</span>
      </span>
      <span class="item-right">${renderBadge(opt.hotkey)}</span>
    `;
    el.addEventListener("click", () => {
      ext.runtime.sendMessage({ type: opt.actionId }).catch(() => {});
    });
    listEl.appendChild(el);
    ui.items.push({
      runtimeAction: opt.actionId,
      hotkey: opt.hotkey,
      label: opt.label,
      // preview.domId is what updateSelection reads to send PREVIEW_TAB
      // for arrow-key selection (the actions/close-and-select branch).
      // Adding duplicate-prompt to that branch in popup.js completes
      // the wiring on the popup side.
      preview: opt.domId ? { domId: opt.domId } : undefined,
    });
  }

  updateSelection();
  updateHeader("Duplicate tab already open");
}

// View registry
VIEWS["reorder-tabs"]       = () => showReorderTabs();
VIEWS["split-view"]         = () => showSplitView();
VIEWS["close-and-select"]   = () => showCloseAndSelect();
VIEWS["move-to-folder"]     = () => showMoveToFolder();
VIEWS["open-in-container"]  = () => showOpenInContainer();
VIEWS["profiles"]           = () => showProfiles();
VIEWS["duplicate-prompt"]   = (params) => showDuplicatePrompt(params);
