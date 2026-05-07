"use strict";

// Rendering helpers for the popup. These functions write into popup.js's
// top-level `let` bindings (selectedIndex, sectionStarts, items) and read
// the DOM refs declared there (listEl, headerEl, viewTitle, etc.) — all
// share the same script-global lexical scope because every popup script
// is loaded as a plain <script> tag.
//
// Pure helpers used here come from shared/dom-utils.js: escapeHtml,
// escapeAttr, extractFavicon, extractDomain.

// Render a hotkey badge. Multi-character labels (e.g. "⇧R", "⇧1") get the
// wider min-width so paired-shift variants line up with single-char badges.
function renderBadge(text) {
  if (text == null || text === "") return "";
  const s = String(text);
  const wide = s.length > 1 ? " badge-wide" : "";
  return `<span class="item-badge${wide}">${escapeHtml(s)}</span>`;
}

function updateHeader(title, hint) {
  if (!title) {
    headerEl.classList.add("hidden");
    backButton.classList.add("hidden");
    viewTitle.textContent = "";
    headerHint.classList.add("hidden");
    return;
  }

  headerEl.classList.remove("hidden");
  backButton.classList.remove("hidden");
  viewTitle.textContent = title;

  headerHint.innerHTML = "";
  if (hint) {
    if (typeof hint === "string") {
      headerHint.innerHTML = hint;
    } else if (Array.isArray(hint)) {
      for (const h of hint) {
        const el = document.createElement("span");
        el.className = "header-hint-item";
        el.innerHTML = `<span class="header-hint-badge">${h.key}</span> ${escapeHtml(h.label)}`;
        if (h.onClick) el.addEventListener("click", h.onClick);
        headerHint.appendChild(el);
      }
    }
    headerHint.classList.remove("hidden");
  } else {
    headerHint.classList.add("hidden");
  }
}

function createTabElement(tab, badge) {
  const el = document.createElement("div");
  el.className = "list-item" + (tab.pending ? " tab-pending" : "");
  el.dataset.domId = tab.domId;

  const domain = extractDomain(tab.url);
  const favicon = extractFavicon(tab.favIconUrl);

  let wsHtml = "";
  if (tab.workspaceId && tab.workspaceId !== activeWorkspaceId) {
    const ws = workspaceMap[tab.workspaceId];
    if (ws) {
      const wsIcon = ws.svgContent
        ? `<span class="row-ws-icon">${ws.svgContent}</span>`
        : "";
      wsHtml = `<span class="row-workspace">${wsIcon}${escapeHtml(ws.name)}</span>`;
    }
  }

  const subtitleHtml = domain
    ? `<span class="item-subtitle"><span class="subtitle-domain">${escapeHtml(domain)}</span></span>`
    : "";

  const badgeHtml = badge !== null
    ? renderBadge(badge)
    : `<span class="item-badge-placeholder"></span>`;

  el.innerHTML = `
    ${favicon
      ? `<img class="item-icon" src="${escapeAttr(favicon)}">`
      : `<span class="item-icon-placeholder">○</span>`}
    <span class="item-text">
      <span class="item-title">${escapeHtml(tab.title || "Untitled")}</span>
      ${subtitleHtml}
    </span>
    <span class="item-right">${wsHtml}${badgeHtml}</span>
  `;

  // Attach error handler via JS instead of inline onerror (CSP blocks inline handlers)
  const img = el.querySelector("img.item-icon");
  if (img) {
    img.addEventListener("error", () => { img.style.display = "none"; });
  }

  el.addEventListener("click", () => activateTab(tab.domId));
  el.addEventListener("mouseenter", () => {
    ext.runtime.sendMessage({ type: "preview-tab", domId: tab.domId }).catch(() => {});
  });
  el.addEventListener("mouseleave", () => {
    ext.runtime.sendMessage({ type: "clear-preview" }).catch(() => {});
  });
  return el;
}

function renderTabList(tabs, title, hint) {
  selectedIndex = -1;
  sectionStarts = [0];
  listEl.innerHTML = "";

  if (tabs.length === 0) {
    items = [];
    listEl.innerHTML = `<div class="empty-state">No tabs</div>`;
    updateHeader(title, hint);
    return;
  }

  // Build render order: group split siblings together
  const rendered = new Set();
  const orderedItems = [];
  let slotIndex = 1; // tracks the 1-9 keybinding slot

  for (let i = 0; i < tabs.length; i++) {
    if (rendered.has(i)) continue;

    const tab = tabs[i];
    const badge = slotIndex <= 9 ? String(slotIndex) : null;

    if (tab.splitGroupId) {
      const siblings = [];
      for (let j = 0; j < tabs.length; j++) {
        if (tabs[j].splitGroupId === tab.splitGroupId) {
          siblings.push({ tab: tabs[j], index: j });
        }
      }

      if (siblings.length > 1) {
        const rowEl = document.createElement("div");
        rowEl.className = "split-row";

        const pairEl = document.createElement("div");
        pairEl.className = "split-pair";

        for (let s = 0; s < siblings.length; s++) {
          const sib = siblings[s];
          rendered.add(sib.index);
          orderedItems.push(sib.tab);

          if (s > 0) {
            const sep = document.createElement("div");
            sep.className = "split-pair-indicator";
            sep.textContent = "┃";
            pairEl.appendChild(sep);
          }

          pairEl.appendChild(createTabElement(sib.tab, null));
        }

        rowEl.appendChild(pairEl);

        if (badge !== null) {
          const badgeEl = document.createElement("span");
          badgeEl.className = "split-row-badge";
          badgeEl.innerHTML = renderBadge(badge);
          rowEl.appendChild(badgeEl);
        }

        listEl.appendChild(rowEl);
        slotIndex++;
        continue;
      }
    }

    rendered.add(i);
    orderedItems.push(tab);
    listEl.appendChild(createTabElement(tab, badge));
    slotIndex++;
  }

  items = orderedItems;
  updateSelection();
  updateHeader(title, hint);
}
