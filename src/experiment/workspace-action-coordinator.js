"use strict";

// Serializes workspace switch/move actions and revalidates the target row at
// execution time. Visible and hidden chord paths can both queue actions; this
// boundary keeps stale row intents from running after the model has changed.
(function(scope) {
  function createWorkspaceActionCoordinator(deps) {
    deps = deps || {};
    let busy = false;

    function currentVersion() {
      return typeof deps.getVersion === "function" ? deps.getVersion() : null;
    }

    function findWorkspace(workspaceId) {
      return typeof deps.getWorkspaceRow === "function" ? deps.getWorkspaceRow(workspaceId) : null;
    }

    function versionMatches(expectedVersion) {
      if (expectedVersion == null) return true;
      return currentVersion() === expectedVersion;
    }

    function validateWorkspace(args, allowActive) {
      const workspaceId = args && args.workspaceId;
      const row = findWorkspace(workspaceId);
      if (!row) return { ok: false, reason: "missing-row" };
      if (args.expectedRowId && row.uuid !== args.expectedRowId) return { ok: false, reason: "row-mismatch" };
      if (!allowActive && row.isActive) return { ok: false, reason: "active-row" };
      return { ok: true, row };
    }

    async function run(action, args, execute) {
      if (busy) return { kind: "stale", action, reason: "busy" };
      busy = true;
      try {
        if (!versionMatches(args && args.currentVersion)) {
          return { kind: "stale", action, reason: "version-mismatch" };
        }
        return await execute();
      } finally {
        busy = false;
      }
    }

    async function executeWorkspaceSwitch(args) {
      args = args || {};
      return run("workspace-switch", args, async () => {
        const validation = validateWorkspace(args, false);
        if (!validation.ok) return { kind: validation.reason === "active-row" ? "noop" : "stale", action: "workspace-switch", reason: validation.reason };
        const ok = typeof deps.switchWorkspace === "function" && await deps.switchWorkspace(args.workspaceId);
        return ok ? { kind: "executed", action: "workspace-switch" } : { kind: "stale", action: "workspace-switch", reason: "switch-failed" };
      });
    }

    async function executeWorkspaceMove(args) {
      args = args || {};
      return run("workspace-move", args, async () => {
        const validation = validateWorkspace(args, false);
        if (!validation.ok) return { kind: validation.reason === "active-row" ? "noop" : "stale", action: "workspace-move", reason: validation.reason };
        const ok = typeof deps.moveToWorkspace === "function" && await deps.moveToWorkspace(args.workspaceId, !!args.switchToTarget);
        return ok ? { kind: "executed", action: "workspace-move" } : { kind: "stale", action: "workspace-move", reason: "move-failed" };
      });
    }

    return {
      executeWorkspaceSwitch,
      executeWorkspaceMove,
      isBusy: () => busy,
    };
  }

  scope.createWorkspaceActionCoordinator = createWorkspaceActionCoordinator;
})(this);
