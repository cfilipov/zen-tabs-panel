"use strict";

(function(scope) {
  function workspaceIdOf(tab) {
    try { return tab?.getAttribute?.("zen-workspace-id") || null; }
    catch (e) { return null; }
  }

  function isEssential(tab) {
    try { return !!tab?.hasAttribute?.("zen-essential"); }
    catch (e) { return false; }
  }

  function selectTabsForDomainClose(tabs, options) {
    const domain = String(options?.domain || "");
    const workspaceId = options?.workspaceId && options.workspaceId !== "all" ? String(options.workspaceId) : "all";
    const includePinned = !!options?.includePinned;
    const domainOf = typeof options?.domainOf === "function" ? options.domainOf : () => "";
    const selected = [];
    let skippedPinned = 0;
    let skippedEssential = 0;

    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (domainOf(tab) !== domain) continue;
      if (workspaceId !== "all" && workspaceIdOf(tab) !== workspaceId) continue;
      if (isEssential(tab)) {
        skippedEssential += 1;
        continue;
      }
      if (tab?.pinned && !includePinned) {
        skippedPinned += 1;
        continue;
      }
      selected.push(tab);
    }

    return { tabs: selected, skippedPinned, skippedEssential };
  }

  scope.selectTabsForDomainClose = selectTabsForDomainClose;
})(this);
