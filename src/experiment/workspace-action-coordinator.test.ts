import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const coordinatorSource = readFileSync(join(experimentRoot, "workspace-action-coordinator.js"), "utf8");
const apiSource = readFileSync(join(experimentRoot, "api.js"), "utf8");

function loadCoordinatorFactory() {
  const sandbox: Record<string, any> = {};
  vm.runInNewContext(coordinatorSource, sandbox);
  return sandbox.createWorkspaceActionCoordinator;
}

function functionBody(name: string) {
  let start = apiSource.indexOf(`function ${name}`);
  if (start < 0) start = apiSource.indexOf(`${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const signatureEnd = apiSource.indexOf(")", start);
  const open = apiSource.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = open; index < apiSource.length; index++) {
    const char = apiSource[index];
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth === 0) return apiSource.slice(open + 1, index);
  }
  throw new Error(`Could not parse function body for ${name}`);
}

describe("workspace action coordinator", () => {
  it("serializes concurrent workspace switch intents", async () => {
    const createWorkspaceActionCoordinator = loadCoordinatorFactory();
    let release!: () => void;
    const firstSwitch = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const coordinator = createWorkspaceActionCoordinator({
      getWorkspaceRow: (workspaceId: string) => ({ uuid: workspaceId, isActive: false }),
      switchWorkspace: async (workspaceId: string) => {
        calls.push(workspaceId);
        await firstSwitch;
        return true;
      },
    });

    const first = coordinator.executeWorkspaceSwitch({ workspaceId: "one", expectedRowId: "one" });
    expect(coordinator.isBusy()).toBe(true);
    const second = await coordinator.executeWorkspaceSwitch({ workspaceId: "two", expectedRowId: "two" });
    release();

    expect(await first).toEqual({ kind: "executed", action: "workspace-switch" });
    expect(second).toEqual({ kind: "stale", action: "workspace-switch", reason: "busy" });
    expect(calls).toEqual(["one"]);
  });

  it("rejects stale row versions before executing a workspace action", async () => {
    const createWorkspaceActionCoordinator = loadCoordinatorFactory();
    const calls: string[] = [];
    const coordinator = createWorkspaceActionCoordinator({
      getVersion: () => 2,
      getWorkspaceRow: (workspaceId: string) => ({ uuid: workspaceId, isActive: false }),
      moveToWorkspace: async (workspaceId: string) => {
        calls.push(workspaceId);
        return true;
      },
    });

    const result = await coordinator.executeWorkspaceMove({
      workspaceId: "target",
      expectedRowId: "target",
      currentVersion: 1,
    });

    expect(result).toEqual({ kind: "stale", action: "workspace-move", reason: "version-mismatch" });
    expect(calls).toEqual([]);
  });

  it("rejects moved rows before executing", async () => {
    const createWorkspaceActionCoordinator = loadCoordinatorFactory();
    const coordinator = createWorkspaceActionCoordinator({
      getWorkspaceRow: () => ({ uuid: "different", isActive: false }),
      switchWorkspace: async () => true,
    });

    await expect(coordinator.executeWorkspaceSwitch({
      workspaceId: "target",
      expectedRowId: "target",
    })).resolves.toEqual({ kind: "stale", action: "workspace-switch", reason: "row-mismatch" });
  });

  it("routes workspace activation branches through the coordinator", () => {
    const visible = functionBody("activateVisibleActionIntent");
    const chromeOwned = functionBody("activateChromeOwnedRowIntent");

    expect(visible).toMatch(/workspaceActionCoordinator\.executeWorkspaceSwitch/);
    expect(visible).not.toMatch(/void switchWorkspaceByIndexInternal/);
    expect(chromeOwned).toMatch(/workspaceActionCoordinator\.executeWorkspaceMove/);
    expect(chromeOwned).not.toMatch(/moveSelectedTabsToWorkspaceInternal\(row\.uuid/);
  });
});
