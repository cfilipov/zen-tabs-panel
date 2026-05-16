import { describe, expect, it } from "vitest";
import type { BridgeKeyData } from "../chord-bridge";
import { createBridgeDispatchController } from "./bridge-dispatch";

function key(key: string): BridgeKeyData {
  return { key };
}

function createHarness() {
  const events: string[] = [];
  const controller = createBridgeDispatchController({
    dispatchKey: (input) => {
      events.push(`key:${input.key}`);
    },
    armRevealTimer: () => events.push("arm"),
    clearRevealTimer: () => events.push("clear"),
  });
  return { controller, events };
}

describe("bridge dispatch controller", () => {
  it("holds keys before bridge ready and drains buffered keys before held live keys", async () => {
    const { controller, events } = createHarness();

    controller.queueOrHold(key("h"));
    await controller.drainReply({ buffered: [key("b")] });

    expect(controller.ready).toBe(true);
    expect(events).toEqual(["arm", "key:b", "arm", "key:h"]);
  });

  it("serializes live keys after the bridge is ready", async () => {
    const { controller, events } = createHarness();

    await controller.drainReply({ buffered: [] });
    controller.queueOrHold(key("a"));
    controller.queueOrHold(key("b"));
    await Promise.resolve();

    expect(events).toEqual(["arm", "arm", "key:a", "arm", "key:b"]);
  });

  it("reports keydown capture requirements while not ready", async () => {
    const { controller } = createHarness();

    expect(controller.keydownInput(key("x"))).toEqual({ preventDefault: true, stopPropagation: true });
    await controller.drainReply({ buffered: [] });
    expect(controller.keydownInput(key("y"))).toEqual({ preventDefault: true, stopPropagation: false });
  });

  it("stops stale warm-rearm drains before marking ready", async () => {
    const events: string[] = [];
    let release: () => void = () => {};
    const controller = createBridgeDispatchController({
      dispatchKey: async (input) => {
        events.push(`key:${input.key}`);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      armRevealTimer: () => events.push("arm"),
      clearRevealTimer: () => events.push("clear"),
    });

    const generation = controller.resetForWarmRearm();
    const drain = controller.drainReply({ buffered: [key("old"), key("never")] }, generation);
    await Promise.resolve();
    controller.resetForWarmRearm();
    release();
    await drain;

    expect(controller.ready).toBe(false);
    expect(events).toEqual(["clear", "arm", "key:old", "clear"]);
  });

  it("force-ready drains buffered keys before held keys through the live queue", async () => {
    const { controller, events } = createHarness();

    controller.queueOrHold(key("held"));
    controller.forceReady({ buffered: [key("buffered")] });
    await Promise.resolve();

    expect(controller.ready).toBe(true);
    expect(events).toEqual(["clear", "arm", "key:buffered", "arm", "key:held"]);
  });
});
