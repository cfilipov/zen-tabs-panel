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

async function flushDispatchQueue() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("bridge dispatch controller", () => {
  it("holds keys before bridge ready and drains buffered keys before held live keys", async () => {
    const { controller, events } = createHarness();

    controller.queueOrHold(key("h"));
    await controller.drainReply({ buffered: [key("b")] });

    expect(controller.ready).toBe(true);
    expect(events).toEqual(["key:b", "key:h", "arm"]);
  });

  it("serializes live keys after the bridge is ready", async () => {
    const { controller, events } = createHarness();

    await controller.drainReply({ buffered: [] });
    controller.queueOrHold(key("a"));
    controller.queueOrHold(key("b"));
    await flushDispatchQueue();

    expect(events).toEqual(["arm", "clear", "key:a", "clear", "key:b", "arm"]);
  });

  it("does not arm the reveal timer for an idle warm-prerender ready reply", async () => {
    const { controller, events } = createHarness();

    await controller.drainReply({ buffered: [], armRevealTimer: false });

    expect(controller.ready).toBe(true);
    expect(events).toEqual([]);
  });

  it("reports keydown capture requirements while not ready", async () => {
    const { controller } = createHarness();

    expect(controller.keydownInput(key("x"))).toEqual({ preventDefault: true, stopPropagation: true });
    await controller.drainReply({ buffered: [] });
    expect(controller.keydownInput(key("y"))).toEqual({ preventDefault: true, stopPropagation: false });
  });

  it("processes visible popup keydown even if the bridge is not ready yet", async () => {
    const { controller, events } = createHarness();

    expect(controller.visibleKeydownInput(key(" "))).toEqual({ preventDefault: true, stopPropagation: true });
    await flushDispatchQueue();

    expect(controller.ready).toBe(true);
    expect(events).toEqual(["clear", "key: ", "arm"]);
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
    expect(events).toEqual(["clear", "key:old", "clear"]);
  });

  it("force-ready drains buffered keys before held keys through the live queue", async () => {
    const { controller, events } = createHarness();

    controller.queueOrHold(key("held"));
    controller.forceReady({ buffered: [key("buffered")] });
    await flushDispatchQueue();

    expect(controller.ready).toBe(true);
    expect(events).toEqual(["clear", "key:buffered", "key:held", "arm"]);
  });

  it("force-ready waits for the active visible dispatch before forced keys", async () => {
    const events: string[] = [];
    let release: () => void = () => {};
    const controller = createBridgeDispatchController({
      dispatchKey: async (input) => {
        events.push(`key:${input.key}`);
        if (input.key === "stale") {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      },
      armRevealTimer: () => events.push("arm"),
      clearRevealTimer: () => events.push("clear"),
    });

    await controller.drainReply({ buffered: [] });
    controller.queueOrHold(key("stale"));
    await Promise.resolve();
    controller.forceReady({ buffered: [key("forced")] });
    await flushDispatchQueue();

    expect(events).toEqual(["arm", "clear", "key:stale", "clear"]);
    release();
    await flushDispatchQueue();

    expect(events).toEqual(["arm", "clear", "key:stale", "clear", "key:forced", "arm"]);
  });

  it("warm rearm cancels a stale live dispatch before visible popup keys", async () => {
    const events: string[] = [];
    let release: () => void = () => {};
    const controller = createBridgeDispatchController({
      dispatchKey: async (input) => {
        events.push(`key:${input.key}`);
        if (input.key === "stale") {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      },
      armRevealTimer: () => events.push("arm"),
      clearRevealTimer: () => events.push("clear"),
    });

    await controller.drainReply({ buffered: [] });
    controller.queueOrHold(key("stale"));
    await Promise.resolve();
    controller.resetForWarmRearm();
    controller.visibleKeydownInput(key("visible"));
    await flushDispatchQueue();

    expect(events).toEqual(["arm", "clear", "key:stale", "clear", "clear", "key:visible", "arm"]);
    release();
    await flushDispatchQueue();

    expect(events).toEqual(["arm", "clear", "key:stale", "clear", "clear", "key:visible", "arm"]);
  });

  it("arms reveal only after a single async buffered key finishes", async () => {
    const events: string[] = [];
    let release: () => void = () => {};
    const controller = createBridgeDispatchController({
      dispatchKey: async (input) => {
        events.push(`start:${input.key}`);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        events.push(`finish:${input.key}`);
      },
      armRevealTimer: () => events.push("arm"),
      clearRevealTimer: () => events.push("clear"),
    });

    const drain = controller.drainReply({ buffered: [key("1")] });
    await Promise.resolve();

    expect(events).toEqual(["start:1"]);
    release();
    await drain;

    expect(events).toEqual(["start:1", "finish:1", "arm"]);
  });

  it("does not arm reveal while an intermediate buffered drill key is running", async () => {
    const events: string[] = [];
    let release: () => void = () => {};
    const controller = createBridgeDispatchController({
      dispatchKey: async (input) => {
        events.push(`start:${input.key}`);
        if (input.key === "1") {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        events.push(`finish:${input.key}`);
      },
      armRevealTimer: () => events.push("arm"),
      clearRevealTimer: () => events.push("clear"),
    });

    const drain = controller.drainReply({ buffered: [key("1"), key("2")] });
    await Promise.resolve();

    expect(events).toEqual(["start:1"]);
    release();
    await drain;

    expect(events).toEqual(["start:1", "finish:1", "start:2", "finish:2", "arm"]);
  });
});
