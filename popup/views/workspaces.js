"use strict";

// Workspace views and helpers
//
// Loaded as <script src="views/workspaces.js"> from popup.html. Cross-file
// references (ui/tabState/wsState, DOM refs, render.js helpers, popup.js
// helpers, shared/dom-utils.js) resolve via the shared script-global scope.

async function showMoveToWorkspace() {
  ui.currentView = "move-to-workspace";
  let workspaces;
  try {
    workspaces = await ext.runtime.sendMessage({ type: "get-workspaces-with-icons" });
  } catch (e) { workspaces = []; }
  const otherWorkspaces = workspaces.filter(ws => !ws.isActive);
  renderWorkspaceList(otherWorkspaces, "Move to workspace");
}

function renderWorkspaceList(workspaces, title) {
  ui.selectedIndex = -1;
  listEl.innerHTML = "";

  if (workspaces.length === 0) {
    ui.items = [];
    listEl.innerHTML = `<div class="empty-state">No other workspaces</div>`;
    updateHeader(title);
    return;
  }

  ui.items = workspaces;

  for (let i = 0; i < workspaces.length; i++) {
    const ws = workspaces[i];
    const badge = (i + 1) <= 9 ? String(i + 1) : null;

    const el = document.createElement("div");
    el.className = "list-item";
    el.dataset.workspaceId = ws.uuid;

    const iconHtml = ws.svgContent
      ? `<span class="workspace-icon">${ws.svgContent}</span>`
      : `<span class="item-icon-placeholder">○</span>`;

    el.innerHTML = `
      ${iconHtml}
      <span class="item-text">
        <span class="item-title">${escapeHtml(ws.name)}</span>
      </span>
      ${badge !== null ? `<span class="item-right">${renderBadge(badge)}</span>` : ""}
    `;

    el.addEventListener("click", () => moveToWorkspace(ws.uuid));
    listEl.appendChild(el);
  }

  updateSelection();
  updateHeader(title);
}
function moveToWorkspace(workspaceId) {
  ext.runtime.sendMessage({ type: "move-selected-tabs-to-workspace", workspaceId }).catch(() => {});
}
