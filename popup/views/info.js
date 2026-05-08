"use strict";

// Tab info + duplicates view (heavy info-display surfaces)
//
// Loaded as <script src="views/info.js"> from popup.html. Cross-file
// references (ui/tabState/wsState, DOM refs, render.js helpers, popup.js
// helpers, shared/dom-utils.js) resolve via the shared script-global scope.

function formatDuration(ms) {
  if (ms < 0) return "unknown";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatBytes(bytes) {
  if (bytes == null) return "N/A";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
async function showTabInfo() {
  ui.currentView = "tab-info";
  ui.items = [];
  ui.selectedIndex = -1;

  let allTabs, info;
  try {
    allTabs = await getAllTabsCached();
    const activeTab = allTabs.find((t) => t.active);
    if (!activeTab) { renderTabInfo(null); return; }
    info = await ext.runtime.sendMessage({ type: "get-tab-info", domId: activeTab.domId });
  } catch (e) {
    renderTabInfo(null);
    return;
  }
  if (!info) { renderTabInfo(null); return; }

  // Gather visits for all unique URLs in session history + current URL
  const urlSet = new Set();
  if (info.url && !info.url.startsWith("about:")) urlSet.add(info.url);
  for (const entry of info.sessionEntries) {
    if (entry.url && !entry.url.startsWith("about:")) urlSet.add(entry.url);
  }

  const titleByUrl = {};
  for (const entry of info.sessionEntries) {
    if (!titleByUrl[entry.url]) titleByUrl[entry.url] = entry.title;
  }
  if (!titleByUrl[info.url]) titleByUrl[info.url] = info.title;

  let allVisits = [];
  try {
    const results = await Promise.all(
      [...urlSet].map((url) => ext.runtime.sendMessage({ type: "get-history-visits", url }).then(
        (visits) => visits.map((v) => ({ ...v, url, title: titleByUrl[url] || url })),
        () => []
      ))
    );
    allVisits = results.flat();
  } catch (e) {}

  const duplicates = allTabs.filter((t) => info.duplicateDomIds.includes(t.domId));
  renderTabInfo(info, allVisits, duplicates);
}

function formatTransition(t) {
  const map = {
    link: "link",
    typed: "typed",
    auto_bookmark: "bookmark",
    auto_subframe: "frame",
    manual_subframe: "frame",
    generated: "generated",
    auto_toplevel: "auto",
    form_submit: "form",
    reload: "reload",
    keyword: "search",
    keyword_generated: "search",
  };
  return map[t] || t || "";
}

function groupVisitsByDate(visits) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const dayFmt = { weekday: "long", month: "long", day: "numeric" };
  const groups = [];
  const map = new Map();

  for (const visit of visits) {
    const d = new Date(visit.visitTime);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let key, label;
    if (day >= today) {
      key = "today";
      label = "Today";
    } else if (day >= yesterday) {
      key = "yesterday";
      label = "Yesterday";
    } else if (day >= thisMonthStart) {
      const daysAgo = Math.round((today - day) / (1000 * 60 * 60 * 24));
      if (daysAgo <= 6) {
        key = `${daysAgo}-days-ago`;
        label = `${daysAgo} days ago`;
      } else {
        const weeksAgo = Math.round(daysAgo / 7);
        key = `${weeksAgo}-weeks-ago`;
        label = weeksAgo === 1 ? "1 week ago" : `${weeksAgo} weeks ago`;
      }
    } else {
      key = `${d.getFullYear()}-${d.getMonth()}`;
      label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    if (!map.has(key)) {
      const group = { label, visits: [], subgroups: null };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).visits.push(visit);
  }

  // Build day subgroups for all groups
  for (const group of groups) {
    const dayMap = new Map();
    group.subgroups = [];
    for (const visit of group.visits) {
      const d = new Date(visit.visitTime);
      const dayKey = d.toISOString().slice(0, 10);
      if (!dayMap.has(dayKey)) {
        const sub = { label: d.toLocaleDateString(undefined, dayFmt), visits: [] };
        dayMap.set(dayKey, sub);
        group.subgroups.push(sub);
      }
      dayMap.get(dayKey).visits.push(visit);
    }
  }

  return groups;
}

function renderVisitRows(visits) {
  let html = `<div class="info-history-table">`;
  for (const visit of visits) {
    const d = new Date(visit.visitTime);
    const datePart = d.toLocaleDateString([], { month: "short", day: "numeric" });
    const timePart = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const transition = formatTransition(visit.transition);
    html += `<div class="info-history-row">`;
    html += `<span class="info-history-date">${datePart}</span>`;
    html += `<span class="info-history-time">${timePart}</span>`;
    html += `<span class="info-history-event">${escapeHtml(transition)}</span>`;
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
}

// After a duplicate row is removed from the DOM, sync the rest of the tab-info
// surface: the section header count, the "Duplicates" stat in the info-grid,
// and the section itself if only the self row remains.
function refreshTabInfoDuplicates() {
  const remaining = listEl.querySelectorAll(".info-duplicate-row").length;

  const section = listEl.querySelector(".info-duplicates-section");
  const statCell = [...listEl.querySelectorAll(".info-cell")]
    .find((c) => c.querySelector(".info-label")?.textContent === "Duplicates");

  if (remaining <= 1) {
    section?.remove();
    statCell?.remove();
    return;
  }

  const headerTitle = section?.querySelector(".info-section-title");
  if (headerTitle) headerTitle.textContent = `Duplicate tabs (${remaining})`;

  const valueEl = statCell?.querySelector(".info-value");
  if (valueEl) valueEl.textContent = String(remaining);

  listEl.querySelectorAll(".info-duplicate-row").forEach((row, i) => {
    const idx = row.querySelector(".dup-index");
    if (idx) idx.textContent = String(i + 1);
  });
}

function renderTabInfo(info, visits, duplicates) {
  listEl.innerHTML = "";

  if (!info) {
    listEl.innerHTML = `<div class="empty-state">No tab info available</div>`;
    updateHeader("Tab info");
    return;
  }

  const now = Date.now();

  const domain = extractDomain(info.url);
  const infoFavicon = extractFavicon(info.favIconUrl);
  const faviconHtml = infoFavicon
    ? `<img class="info-favicon" src="${escapeAttr(infoFavicon)}">`
    : `<span class="info-favicon-placeholder">○</span>`;

  let html = "";

  // Header
  html += `<div class="info-header">
    ${faviconHtml}
    <div class="info-header-text">
      <div class="info-header-title">${escapeHtml(info.title || "Untitled")}</div>
      <div class="info-header-url">${escapeHtml(domain)}</div>
    </div>
  </div>`;

  // Stats grid (two columns)
  html += `<div class="info-grid">`;

  // Tab age from domId timestamp
  const createdTs = parseInt(info.domId.split("-")[0]);
  if (createdTs > 1e12) {
    html += `<div class="info-cell"><span class="info-label">Tab age</span><span class="info-value">${formatDuration(now - createdTs)}</span></div>`;
  }

  if (visits && visits.length > 0) {
    const firstVisit = Math.min(...visits.map((v) => v.visitTime));
    html += `<div class="info-cell"><span class="info-label">First visited</span><span class="info-value">${formatDuration(now - firstVisit)} ago</span></div>`;
  }

  html += `<div class="info-cell"><span class="info-label">Memory</span><span class="info-value">${formatBytes(info.memory)}</span></div>`;

  if (info.cpuTime != null) {
    html += `<div class="info-cell"><span class="info-label">CPU time</span><span class="info-value">${(info.cpuTime / 1e6).toFixed(0)} ms</span></div>`;
  }

  if (visits && visits.length > 0) {
    html += `<div class="info-cell"><span class="info-label">Total visits</span><span class="info-value">${visits.length}</span></div>`;
  }

  if (duplicates && duplicates.length > 1) {
    html += `<div class="info-cell"><span class="info-label">Duplicates</span><span class="info-value">${duplicates.length}</span></div>`;
  }

  html += `</div>`;

  // Duplicates (before history) — includes self
  if (duplicates && duplicates.length > 1) {
    html += `<div class="info-section info-duplicates-section">`;
    html += `<div class="info-section-header"><span class="info-section-title">Duplicate tabs (${duplicates.length})</span> <span class="info-close-others">Close others</span></div>`;
    html += `<div class="info-duplicates-grid">`;
    for (let i = 0; i < duplicates.length; i++) {
      const dup = duplicates[i];
      const isSelf = dup.domId === info.domId;
      const dupAge = formatDuration(now - parseInt(dup.domId.split("-")[0]));
      const ws = dup.workspaceId ? wsState.workspaceMap[dup.workspaceId] : null;
      const wsIcon = ws?.svgContent ? `<span class="dup-ws-icon">${ws.svgContent}</span>` : "";
      const wsName = ws ? escapeHtml(ws.name) : "";
      const wsNote = isSelf ? `<span class="dup-ws-note">(this tab)</span>`
        : (dup.workspaceId === wsState.activeWorkspaceId) ? `<span class="dup-ws-note">(this workspace)</span>` : "";
      html += `<div class="info-duplicate-row${isSelf ? " dup-self" : ""}" data-dom-id="${escapeAttr(dup.domId)}">`;
      html += `<span class="dup-index">${i + 1}</span>`;
      html += `<span class="dup-workspace">${renderTabIndicators(dup)}${wsIcon}${wsName}${wsNote}</span>`;
      html += `<span class="dup-age">open for ${dupAge}</span>`;
      if (!isSelf) {
        html += `<span class="dup-close" title="Close tab">✕</span>`;
      } else {
        html += `<span></span>`;
      }
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  // Combined visit history grouped by date
  if (visits && visits.length > 0) {
    const sorted = [...visits].sort((a, b) => b.visitTime - a.visitTime);
    const groups = groupVisitsByDate(sorted);
    html += `<div class="info-section">`;
    html += `<div class="info-section-title">History</div>`;
    for (const group of groups) {
      html += `<details class="info-date-details" open>`;
      html += `<summary class="info-date-group">${escapeHtml(group.label)}</summary>`;
      for (const sub of group.subgroups) {
        html += `<details class="info-date-details info-date-sub" open>`;
        html += `<summary class="info-date-subgroup">${escapeHtml(sub.label)}</summary>`;
        html += renderVisitRows(sub.visits);
        html += `</details>`;
      }
      html += `</details>`;
    }
    html += `</div>`;
  }

  listEl.innerHTML = html;

  // Wire up duplicate row interactions
  if (duplicates && duplicates.length > 1) {
    for (const row of listEl.querySelectorAll(".info-duplicate-row:not(.dup-self)")) {
      const domId = row.dataset.domId;
      row.addEventListener("click", (e) => {
        if (e.target.classList.contains("dup-close")) return;
        activateTab(domId);
      });
      row.querySelector(".dup-close").addEventListener("click", (e) => {
        e.stopPropagation();
        ext.runtime.sendMessage({ type: "close-tab", domId }).catch(() => {});
        row.remove();
        invalidateAllTabsCache();
        refreshTabInfoDuplicates();
      });
      row.addEventListener("mouseenter", () => {
        ext.runtime.sendMessage({ type: "preview-tab", domId }).catch(() => {});
      });
      row.addEventListener("mouseleave", () => {
        ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
      });
    }
    const closeOthers = listEl.querySelector(".info-close-others");
    if (closeOthers) {
      closeOthers.addEventListener("click", () => {
        for (const dup of duplicates) {
          if (dup.domId === info.domId) continue;
          ext.runtime.sendMessage({ type: "close-tab", domId: dup.domId }).catch(() => {});
        }
        listEl.querySelectorAll(".info-duplicate-row:not(.dup-self)").forEach((r) => r.remove());
        invalidateAllTabsCache();
        refreshTabInfoDuplicates();
      });
    }
  }

  const img = listEl.querySelector("img.info-favicon");
  if (img) {
    img.addEventListener("error", () => { img.style.display = "none"; });
  }

  updateHeader("Tab info");
}
async function showDuplicates(animate) {
  ui.currentView = "duplicates";
  ui.items = [];
  ui.selectedIndex = -1;

  let allTabs;
  try {
    allTabs = await getAllTabsCached();
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">No duplicates</div>`;
    updateHeader("Duplicates");
    return;
  }

  const filtered = filterByWorkspace(allTabs);

  // Group tabs by URL
  const urlGroups = {};
  for (const tab of filtered) {
    if (!tab.url || tab.url === "about:newtab" || tab.url === "about:blank") continue;
    if (!urlGroups[tab.url]) urlGroups[tab.url] = [];
    urlGroups[tab.url].push(tab);
  }

  // Filter to only groups with duplicates, sort by group size descending
  const groups = Object.values(urlGroups)
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length);

  if (groups.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No duplicates</div>`;
    updateHeader("Duplicates");
    return;
  }

  renderDuplicateGroups(groups);
  renderSidebar();
}

function renderDuplicateGroups(groups) {
  ui.sectionStarts = [0];
  const now = Date.now();
  let html = "";

  for (const group of groups) {
    const sample = group[0];
    const domain = extractDomain(sample.url);
    const favicon = extractFavicon(sample.favIconUrl);

    html += `<div class="dup-group">`;
    html += `<div class="dup-group-header">`;
    html += favicon
      ? `<img class="dup-group-favicon" src="${escapeAttr(favicon)}">`
      : `<span class="dup-group-favicon-placeholder">○</span>`;
    html += `<div class="dup-group-text">`;
    html += `<div class="dup-group-title">${escapeHtml(sample.title || "Untitled")}<span class="item-count">${group.length}</span></div>`;
    if (domain) html += `<div class="dup-group-domain">${escapeHtml(domain)}</div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="info-duplicates-grid">`;
    for (let i = 0; i < group.length; i++) {
      const tab = group[i];
      const age = formatDuration(now - parseInt(tab.domId.split("-")[0]));
      const ws = tab.workspaceId ? wsState.workspaceMap[tab.workspaceId] : null;
      const wsIcon = ws?.svgContent ? `<span class="dup-ws-icon">${ws.svgContent}</span>` : "";
      const wsName = ws ? escapeHtml(ws.name) : "";
      const isActive = tab.active;
      const wsNote = isActive ? `<span class="dup-ws-note">(this tab)</span>`
        : (tab.workspaceId === wsState.activeWorkspaceId) ? `<span class="dup-ws-note">(this workspace)</span>` : "";
      html += `<div class="info-duplicate-row${isActive ? " dup-self" : ""}${tab.pending ? " tab-pending" : ""}" data-dom-id="${escapeAttr(tab.domId)}">`;
      html += `<span class="dup-index">${i + 1}</span>`;
      html += `<span class="dup-workspace">${wsIcon}${wsName}${wsNote}</span>`;
      html += `<span class="dup-age">open for ${age}</span>`;
      if (!isActive) {
        html += `<span class="dup-close" title="Close tab">✕</span>`;
      } else {
        html += `<span></span>`;
      }
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  listEl.innerHTML = html;

  // Wire up interactions
  for (const row of listEl.querySelectorAll(".info-duplicate-row:not(.dup-self)")) {
    const domId = row.dataset.domId;
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("dup-close")) return;
      activateTab(domId);
    });
    row.querySelector(".dup-close").addEventListener("click", (e) => {
      e.stopPropagation();
      ext.runtime.sendMessage({ type: "close-tab", domId }).catch(() => {});
      row.remove();
    });
    row.addEventListener("mouseenter", () => {
      ext.runtime.sendMessage({ type: "preview-tab", domId }).catch(() => {});
    });
    row.addEventListener("mouseleave", () => {
      ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
    });
  }

  // Handle favicon errors
  for (const img of listEl.querySelectorAll("img.dup-group-favicon")) {
    img.addEventListener("error", () => { img.style.display = "none"; });
  }

  updateHeader("Duplicates");
}

// View registry
VIEWS["tab-info"]   = () => showTabInfo();
VIEWS["duplicates"] = () => showDuplicates();
