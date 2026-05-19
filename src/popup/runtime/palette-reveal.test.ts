import { describe, expect, it } from "vitest";
import { createPaletteRevealController } from "./palette-reveal";

function timerHarness() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  return {
    callbacks,
    setTimeout(callback: () => void) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(id: unknown) {
      callbacks.delete(id as number);
    },
    fire(id = 1) {
      callbacks.get(id)?.();
    },
  };
}

describe("palette reveal controller", () => {
  it("parses popup instance from the URL and includes it in ready messages", () => {
    const timers = timerHarness();
    const controller = createPaletteRevealController({
      sendReveal: () => {},
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    controller.configureFromSearch("?inst=42&delay=25");

    expect(controller.inst).toBe(42);
    expect(controller.popupReadyMessage()).toEqual({ type: "popup-ready", inst: 42 });
  });

  it("reveals after the configured delay unless cleared", () => {
    const timers = timerHarness();
    const reveals: Array<number | null> = [];
    const controller = createPaletteRevealController({
      sendReveal: (inst) => reveals.push(inst),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    controller.configureFromSearch("?inst=7&delay=10");

    controller.arm();
    timers.fire();

    expect(reveals).toEqual([7]);
  });

  it("does not reveal after pagehide", () => {
    const timers = timerHarness();
    const reveals: Array<number | null> = [];
    const controller = createPaletteRevealController({
      sendReveal: (inst) => reveals.push(inst),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    controller.configureFromSearch("?inst=7&delay=10");

    controller.arm();
    controller.markDead();
    timers.fire();

    expect(reveals).toEqual([]);
  });
});
