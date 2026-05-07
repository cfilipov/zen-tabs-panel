"use strict";

// Tabs by age + most visited views
//
// Loaded as <script src="views/age.js"> from popup.html. Cross-file
// references (ui/tabState/wsState, DOM refs, render.js helpers, popup.js
// helpers, shared/dom-utils.js) resolve via the shared script-global scope.

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
  ui.currentView = "tabs-by-age";
  ui.items = [];
  ui.selectedIndex = -1;

  let allTabs;
  try {
    allTabs = await getAllTabsCached();
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
    return tabState.tabsByAgeNewestFirst ? ageB - ageA : ageA - ageB;
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

  const sortOpts = [{ key: "S", label: "Sort by " + (tabState.tabsByAgeNewestFirst ? "oldest" : "newest"), onClick: () => { tabState.tabsByAgeNewestFirst = !tabState.tabsByAgeNewestFirst; refreshCurrentView(); } }];
  renderTabsByAge(groups);
  renderSidebar(sortOpts);
}

function renderTabsByAge(groups) {
  ui.selectedIndex = -1;
  ui.sectionStarts = [0];
  listEl.innerHTML = "";
  const allItems = [];

  if (groups.length === 0) {
    ui.items = [];
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
      if (tab.workspaceId && tab.workspaceId !== wsState.activeWorkspaceId) {
        const ws = wsState.workspaceMap[tab.workspaceId];
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

  ui.items = allItems;
  updateHeader("Tabs by age");
}
async function showMostVisited(animate) {
  ui.currentView = "most-visited";
  ui.items = [];
  ui.selectedIndex = -1;
  ui.sectionStarts = [0];

  let allTabs;
  try {
    allTabs = await getAllTabsCached();
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
  ui.selectedIndex = -1;
  listEl.innerHTML = "";
  const now = Date.now();

  if (filtered.length === 0) {
    ui.items = [];
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader("Most visited");
    return;
  }

  ui.items = filtered;

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
    if (tab.workspaceId && tab.workspaceId !== wsState.activeWorkspaceId) {
      const ws = wsState.workspaceMap[tab.workspaceId];
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

// View registry
VIEWS["tabs-by-age"]   = () => showTabsByAge();
VIEWS["most-visited"]  = () => showMostVisited();
