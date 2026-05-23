const test = require("node:test");
const assert = require("node:assert/strict");

const { createAutoActionGatekeeper } = require("../src/background/auto-action-gatekeeper.js");

test("auto-close sweep uses the settings snapshot captured at entry", async () => {
  const liveSettings = { autoCloseEnabled: true, autoCloseThreshold: "24h" };
  let executedSnapshot = null;
  const gatekeeper = createAutoActionGatekeeper({
    getSettingsSnapshot: () => liveSettings,
    executeAutoClose: async (snapshot) => {
      liveSettings.autoCloseEnabled = false;
      liveSettings.autoCloseThreshold = "1w";
      await Promise.resolve();
      executedSnapshot = snapshot;
    },
  });

  const result = await gatekeeper.evaluateAutoCloseSweep();

  assert.deepEqual(result, { kind: "executed", action: "auto-close" });
  assert.deepEqual(executedSnapshot, { autoCloseEnabled: true, autoCloseThreshold: "24h" });
});

test("concurrent auto-action evaluations keep independent snapshots", async () => {
  const snapshots = [
    { autoCloseEnabled: true, autoCloseThreshold: "24h" },
    { autoCloseEnabled: true, autoCloseThreshold: "1w" },
  ];
  const executed = [];
  const gatekeeper = createAutoActionGatekeeper({
    getSettingsSnapshot: () => snapshots.shift(),
    executeAutoClose: async (snapshot) => {
      await Promise.resolve();
      executed.push(snapshot);
    },
  });

  await Promise.all([
    gatekeeper.evaluateAutoCloseSweep(),
    gatekeeper.evaluateAutoCloseSweep(),
  ]);

  assert.deepEqual(executed, [
    { autoCloseEnabled: true, autoCloseThreshold: "24h" },
    { autoCloseEnabled: true, autoCloseThreshold: "1w" },
  ]);
});

test("gatekeeper instances do not share module-level state", async () => {
  const calls = [];
  const first = createAutoActionGatekeeper({
    getSettingsSnapshot: () => ({ autoMoveEnabled: true, autoMoveDelay: 10 }),
    executeAutoMove: (tabId, snapshot) => calls.push(["first", tabId, snapshot.autoMoveDelay]),
  });
  const second = createAutoActionGatekeeper({
    getSettingsSnapshot: () => ({ autoMoveEnabled: false, autoMoveDelay: 99 }),
    cancelAutoMove: () => calls.push(["second-cancel"]),
    executeAutoMove: (tabId, snapshot) => calls.push(["second", tabId, snapshot.autoMoveDelay]),
  });

  assert.deepEqual(await first.evaluateAutoMoveOnActivate(7), { kind: "executed", action: "auto-move" });
  assert.deepEqual(await second.evaluateAutoMoveOnActivate(8), { kind: "disabled", action: "auto-move" });
  assert.deepEqual(calls, [["first", 7, 10], ["second-cancel"]]);
});
