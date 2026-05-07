"use strict";

// Domain views
//
// Loaded as <script src="views/domains.js"> from popup.html. Cross-file
// references (ui/tabState/wsState, DOM refs, render.js helpers, popup.js
// helpers, shared/dom-utils.js) resolve via the shared script-global scope.

async function showDomains(animate) {
  ui.currentView = "domains";
  ui.items = [];
  ui.selectedIndex = -1;

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader("Domains");
    return;
  }

  const wsFiltered = filterByWorkspace(allTabs);

  const domainMap = {};
  for (const tab of wsFiltered) {
    let hostname = "";
    try { hostname = new URL(tab.url).hostname; } catch (e) {}
    if (!hostname) continue;
    if (!domainMap[hostname]) domainMap[hostname] = { tabs: [], favicon: "" };
    domainMap[hostname].tabs.push(tab);
    if (!domainMap[hostname].favicon && tab.favIconUrl) {
      domainMap[hostname].favicon = tab.favIconUrl;
    }
  }

  const domains = Object.entries(domainMap)
    .map(([domain, data]) => ({ domain, count: data.tabs.length, favicon: data.favicon }))
    .sort(tabState.domainsSortAlpha
      ? (a, b) => a.domain.localeCompare(b.domain)
      : (a, b) => b.count - a.count);

  const sortOpts = [{ key: "S", label: "Sort by " + (tabState.domainsSortAlpha ? "count" : "A-Z"), onClick: () => { tabState.domainsSortAlpha = !tabState.domainsSortAlpha; refreshCurrentView(); } }];
  renderDomainList(domains, "Domains");
  renderSidebar(sortOpts);
}

function renderDomainList(domains, title) {
  ui.selectedIndex = -1;
  ui.sectionStarts = [0];
  listEl.innerHTML = "";

  if (domains.length === 0) {
    ui.items = [];
    listEl.innerHTML = `<div class="empty-state">No domains</div>`;
    updateHeader(title);
    return;
  }

  ui.items = domains;

  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    const badge = (i + 1) <= 9 ? String(i + 1) : null;

    const el = document.createElement("div");
    el.className = "list-item";
    el.dataset.domain = d.domain;

    let favicon = d.favicon || "";
    if (favicon.startsWith("moz-remote-image://")) {
      try { favicon = new URL(favicon).searchParams.get("url") || ""; } catch (e) { favicon = ""; }
    }
    const canLoad = favicon && !favicon.startsWith("chrome://");

    el.innerHTML = `
      ${canLoad
        ? `<img class="item-icon" src="${escapeAttr(favicon)}">`
        : `<span class="item-icon-placeholder">○</span>`}
      <span class="item-text">
        <span class="item-title">${escapeHtml(d.domain)}</span>
      </span>
      <span class="item-right">
        <span class="item-count">${d.count}</span>
        ${renderBadge(badge)}
        <span class="item-arrow">›</span>
      </span>
    `;

    const img = el.querySelector("img.item-icon");
    if (img) img.addEventListener("error", () => { img.style.display = "none"; });

    el.addEventListener("click", () => {
      navigateToView("domain-tabs", { domain: d.domain });
    });
    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader(title);
}

async function showDomainTabs(domain, animate) {
  ui.currentView = "domain-tabs";
  tabState.currentDomain = domain;

  let allTabs;
  try {
    allTabs = await ext.runtime.sendMessage({ type: "get-all-tabs" });
  } catch (e) {
    renderTabList([], domain);
    return;
  }

  const filtered = allTabs.filter((t) => {
    try { return new URL(t.url).hostname === domain; } catch (e) { return false; }
  });

  const wsFiltered = filterByWorkspace(filtered);

  renderTabList(wsFiltered, domain);
  renderSidebar();
}
