import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type OverlayControllerScope = {
  createOverlayController: (impl?: Record<string, (...args: unknown[]) => unknown>) => {
    create: (view?: string | null, params?: Record<string, unknown> | null) => unknown;
    reveal: () => unknown;
    nextInstance: () => number;
    currentInstance: () => number;
    matchesInstance: (inst?: number | null) => boolean;
    isVisible: () => boolean;
    hasPendingReveal: () => boolean;
    setPendingReveal: (reveal: (() => void) | null) => (() => void) | null;
    clearPendingReveal: (expected?: (() => void) | null) => boolean;
    runPendingReveal: () => boolean;
    beginExplicitReveal: (view?: string | null) => number;
    cancelExplicitReveal: () => number;
    getExplicitRevealView: () => string | null;
    isExplicitRevealCurrent: (token: number) => boolean;
    isExplicitRevealScheduled: (token: number) => boolean;
    markExplicitRevealScheduled: (token: number) => boolean;
    clearExplicitReveal: () => void;
    getExplicitRevealState: () => {
      explicitRevealToken: number;
      explicitRevealView: string | null;
      explicitRevealScheduledToken: number;
    };
  };
};

function loadOverlayControllerScope(): OverlayControllerScope {
  const filename = path.resolve(process.cwd(), "src/experiment/overlay-controller.js");
  const code = fs.readFileSync(filename, "utf8");
  const context: Record<string, unknown> = { console };
  vm.runInNewContext(code, context, { filename });
  return context as OverlayControllerScope;
}

describe("overlay controller", () => {
  it("owns popup instance sequencing and stale-instance checks", () => {
    const controller = loadOverlayControllerScope().createOverlayController();

    expect(controller.currentInstance()).toBe(0);
    expect(controller.matchesInstance(undefined)).toBe(true);
    expect(controller.matchesInstance(null)).toBe(true);

    expect(controller.nextInstance()).toBe(1);
    expect(controller.currentInstance()).toBe(1);
    expect(controller.matchesInstance(1)).toBe(true);
    expect(controller.matchesInstance(0)).toBe(false);

    expect(controller.nextInstance()).toBe(2);
    expect(controller.matchesInstance(1)).toBe(false);
    expect(controller.matchesInstance(2)).toBe(true);
  });

  it("delegates overlay operations through the adapter boundary", () => {
    const create = vi.fn(() => "created");
    const reveal = vi.fn(() => "revealed");
    const controller = loadOverlayControllerScope().createOverlayController({
      create,
      reveal,
      isVisible: () => true,
    });

    expect(controller.create("actions", { source: "test" })).toBe("created");
    expect(create).toHaveBeenCalledWith("actions", { source: "test" });
    expect(controller.reveal()).toBe("revealed");
    expect(reveal).toHaveBeenCalledOnce();
    expect(controller.isVisible()).toBe(true);
    expect(controller.hasPendingReveal()).toBe(false);
  });

  it("owns pending reveal closure identity", () => {
    const controller = loadOverlayControllerScope().createOverlayController();
    const first = vi.fn(() => {
      controller.clearPendingReveal(first);
    });
    const stale = vi.fn();

    expect(controller.hasPendingReveal()).toBe(false);
    controller.setPendingReveal(first);
    expect(controller.hasPendingReveal()).toBe(true);
    expect(controller.clearPendingReveal(stale)).toBe(false);
    expect(controller.hasPendingReveal()).toBe(true);
    expect(controller.runPendingReveal()).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    expect(controller.hasPendingReveal()).toBe(false);
    expect(controller.runPendingReveal()).toBe(false);
  });

  it("owns explicit reveal scheduler tokens", () => {
    const controller = loadOverlayControllerScope().createOverlayController();

    const first = controller.beginExplicitReveal("last-visited");
    expect(first).toBe(1);
    expect(controller.getExplicitRevealView()).toBe("last-visited");
    expect(controller.isExplicitRevealCurrent(first)).toBe(true);
    expect(controller.markExplicitRevealScheduled(first)).toBe(true);
    expect(controller.markExplicitRevealScheduled(first)).toBe(false);
    expect(controller.isExplicitRevealScheduled(first)).toBe(true);

    const second = controller.cancelExplicitReveal();
    expect(second).toBe(2);
    expect(controller.isExplicitRevealCurrent(first)).toBe(false);
    expect(controller.getExplicitRevealState()).toMatchObject({
      explicitRevealToken: 2,
      explicitRevealView: null,
      explicitRevealScheduledToken: 0,
    });
  });
});
