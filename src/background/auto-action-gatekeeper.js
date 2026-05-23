(function(root) {
  "use strict";

  function clonePlain(value) {
    if (!value || typeof value !== "object") return {};
    try { return JSON.parse(JSON.stringify(value)); }
    catch (e) { return Object.assign({}, value); }
  }

  function createAutoActionGatekeeper(deps) {
    if (!deps || typeof deps.getSettingsSnapshot !== "function") {
      throw new Error("createAutoActionGatekeeper requires getSettingsSnapshot");
    }
    const executeAutoClose = deps.executeAutoClose || (() => {});
    const executeAutoMove = deps.executeAutoMove || (() => {});
    const cancelAutoMove = deps.cancelAutoMove || (() => {});

    async function snapshotSettings() {
      return clonePlain(await deps.getSettingsSnapshot());
    }

    async function evaluateAutoCloseSweep(tabSnapshots) {
      const snapshot = await snapshotSettings();
      if (!snapshot.autoCloseEnabled) return { kind: "disabled", action: "auto-close" };
      await executeAutoClose(snapshot, Array.isArray(tabSnapshots) ? tabSnapshots.slice() : undefined);
      return { kind: "executed", action: "auto-close" };
    }

    async function evaluateAutoMoveOnActivate(tabId) {
      const snapshot = await snapshotSettings();
      if (!snapshot.autoMoveEnabled) {
        cancelAutoMove();
        return { kind: "disabled", action: "auto-move" };
      }
      await executeAutoMove(tabId, snapshot);
      return { kind: "executed", action: "auto-move" };
    }

    return {
      evaluateAutoCloseSweep,
      evaluateAutoMoveOnActivate,
    };
  }

  root.createAutoActionGatekeeper = createAutoActionGatekeeper;
  if (typeof module !== "undefined") module.exports = { createAutoActionGatekeeper };
})(typeof globalThis !== "undefined" ? globalThis : this);
