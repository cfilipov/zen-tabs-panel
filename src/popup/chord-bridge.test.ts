import { describe, expect, it } from "vitest";
import { installChordBridgeHandlers, type BridgeKeyData } from "./chord-bridge";

function dispatchBridge(type: string, data: unknown = {}) {
  document.dispatchEvent(new CustomEvent("ztt:bridge-message", {
    detail: JSON.stringify({ type, data }),
  }));
}

describe("chord bridge", () => {
  it("routes typed bridge key payloads without synthetic keyboard events", () => {
    const keys: BridgeKeyData[] = [];
    const uninstall = installChordBridgeHandlers({
      onDeliverKey: (input) => keys.push(input),
      onWarmRearm: () => {},
      onForceReady: () => {},
      onInvalidChord: () => {},
      onPaletteRevealed: () => {},
      onCancelReveal: () => {},
      onGoToActions: () => {},
    });

    dispatchBridge("deliver-key", { key: "r", code: "KeyR" });
    uninstall();

    expect(keys).toEqual([{ key: "r", code: "KeyR" }]);
  });

  it("routes lifecycle bridge messages", () => {
    const calls: string[] = [];
    const uninstall = installChordBridgeHandlers({
      onDeliverKey: () => {},
      onWarmRearm: (data) => calls.push(`warm:${data.view}`),
      onForceReady: (data) => calls.push(`force:${data.buffered?.length ?? 0}`),
      onInvalidChord: (data) => calls.push(`invalid:${data.key}`),
      onPaletteRevealed: () => calls.push("revealed"),
      onCancelReveal: () => calls.push("cancel"),
      onGoToActions: () => calls.push("actions"),
    });

    dispatchBridge("warm-rearm", { view: "actions" });
    dispatchBridge("force-ready", { buffered: [{ key: " " }] });
    dispatchBridge("invalid-chord", { key: "\\" });
    dispatchBridge("palette-revealed");
    dispatchBridge("cancel-reveal");
    dispatchBridge("go-to-actions");
    uninstall();

    expect(calls).toEqual(["warm:actions", "force:1", "invalid:\\", "revealed", "cancel", "actions"]);
  });
});
