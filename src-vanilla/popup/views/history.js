"use strict";

// History views (navigation, last visited, recently closed)
//
// Loaded as <script src="views/history.js"> from popup.html. Cross-file
// references (ui/tabState/wsState, DOM refs, render.js helpers, popup.js
// helpers, shared/dom-utils.js) resolve via the shared script-global scope.

async function showNavigation() {
  ui.currentView = "navigation";
  ui.items = [];
  ui.selectedIndex = -1;
  ui.sectionStarts = [0];

  let history;
  try {
    history = await ext.runtime.sendMessage({ type: "get-navigation-history" });
  } catch (e) {}

  if (!history || !history.entries || history.entries.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No navigation history</div>`;
    updateHeader("Tab history");
    return;
  }

  listEl.innerHTML = "";
  const currentIndex = history.index;
  let itemNum = 1;

  for (let i = 0; i < history.entries.length; i++) {
    const entry = history.entries[i];
    const isCurrent = i === currentIndex;
    const domain = extractDomain(entry.url);

    const el = document.createElement("div");
    el.className = "list-item" + (isCurrent ? " nav-current" : "");

    let badge = null;
    let extraBadge = "";
    if (!isCurrent) {
      if (itemNum <= 9) { badge = String(itemNum); itemNum++; }
    }
    if (i === currentIndex - 1) extraBadge = renderBadge("B");
    if (i === currentIndex + 1) extraBadge = renderBadge("F");

    const label = i < currentIndex ? "← " : i > currentIndex ? "→ " : "● ";

    el.innerHTML = `
      <span class="item-icon-placeholder nav-direction">${label}</span>
      <span class="item-text">
        <span class="item-title">${escapeHtml(entry.title || entry.url || "Untitled")}</span>
        ${domain ? `<span class="item-subtitle">${escapeHtml(domain)}</span>` : ""}
      </span>
      <span class="item-right">
        ${extraBadge}
        ${renderBadge(badge)}
      </span>
    `;

    if (!isCurrent) {
      const navIndex = i;
      el.addEventListener("click", () => {
        ext.runtime.sendMessage({ type: "navigate-to-history-index", index: navIndex }).catch(() => {});
      });
    }

    ui.items.push({ navIndex: i, isCurrent });
    listEl.appendChild(el);
  }

  // Pre-select the current item
  ui.selectedIndex = currentIndex;
  updateSelection();
  updateHeader("Tab history");
}
async function showLastVisited(animate) {
  ui.currentView = "last-visited";

  let allTabs;
  try {
    allTabs = await getAllTabsCached();
  } catch (e) {
    if (ui.currentView !== "last-visited") return;
    renderTabList([], "Recent");
    return;
  }

  // Bail if a newer WarmRearm took over mid-fetch — otherwise our
  // render would clobber listEl over the newer view's content, and
  // a chord-key dispatched into that newer view would scan stale
  // rows (e.g. matching a workspace-switch row from the actions
  // menu instead of the recents tab the user actually picked).
  if (ui.currentView !== "last-visited") return;

  allTabs.sort((a, b) => b.lastAccessed - a.lastAccessed);

  const activeTab = allTabs.find((t) => t.active);
  const activeSplitGroupId = activeTab?.splitGroupId;

  const filtered = filterByWorkspace(allTabs.filter((t) => {
    if (t.active) return false;
    if (activeSplitGroupId && t.splitGroupId === activeSplitGroupId) return false;
    if (!t.url || t.url === "about:newtab" || t.url === "about:blank" || t.url === "about:home") return false;
    return true;
  }));

  renderTabList(filtered, "Recent");
  renderSidebar();
}

async function showRecentlyClosed(animate) {
  ui.currentView = "recently-closed";
  ui.selectedIndex = -1;
  ui.sectionStarts = [0];
  renderSidebar(null, { hintsOnly: true });

  let entries;
  try {
    entries = await ext.runtime.sendMessage({ type: "get-recently-closed" });
  } catch (e) { entries = []; }

  if (!entries || entries.length === 0) {
    ui.items = [];
    listEl.innerHTML = `<div class="empty-state">No recently closed tabs</div>`;
    updateHeader("Recently closed");
    return;
  }

  renderRecentlyClosedList(entries);
  updateHeader("Recently closed");
}

function renderRecentlyClosedList(entries) {
  listEl.innerHTML = "";
  ui.items = [];

  let slotIndex = 1;
  for (const entry of entries) {
    const badge = slotIndex <= 9 ? String(slotIndex) : null;

    const domain = extractDomain(entry.url);
    const favicon = extractFavicon(entry.favIconUrl);

    const el = document.createElement("div");
    el.className = "list-item";
    el.dataset.sessionId = entry.sessionId;

    const badgeHtml = badge !== null
      ? renderBadge(badge)
      : `<span class="item-badge-placeholder"></span>`;

    el.innerHTML = `
      ${favicon
        ? `<img class="item-icon" src="${escapeAttr(favicon)}">`
        : `<span class="item-icon-placeholder">○</span>`}
      <span class="item-text">
        <span class="item-title">${renderTabIndicators(entry)}${escapeHtml(entry.title || entry.url || "Untitled")}</span>
        ${domain ? `<span class="item-subtitle"><span class="subtitle-domain">${escapeHtml(domain)}</span></span>` : ""}
      </span>
      <span class="item-right"><span class="item-badge-stack">${badgeHtml}<span class="item-restore" title="Restore tab (keeps menu open)">↺</span></span></span>
    `;

    const img = el.querySelector("img.item-icon");
    if (img) img.addEventListener("error", () => { img.style.display = "none"; });

    const sessionId = entry.sessionId;
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("item-restore")) {
        e.stopPropagation();
        restoreRowAndReindex(el);
        return;
      }
      ext.runtime.sendMessage({ type: "restore-closed-tab", sessionId }).catch(() => {});
    });

    ui.items.push({ sessionId });
    listEl.appendChild(el);
    slotIndex++;
  }

  updateSelection();
}

// View registry
VIEWS["navigation"]      = () => showNavigation();
VIEWS["last-visited"]    = () => showLastVisited();
VIEWS["recently-closed"] = () => showRecentlyClosed();
