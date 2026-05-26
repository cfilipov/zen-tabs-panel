import { describe, expect, it, vi } from "vitest";
import { createNativePalettePanelController, usesFitContentHeight } from "./native-palette-panel";
import type { ViewId } from "../../shared/types";

function immediateTimeout(fn: () => void) {
  fn();
  return 1;
}

async function flushPanelResize() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("native palette panel controller", () => {
  it("classifies compact fit-content views", () => {
    expect(usesFitContentHeight("profiles")).toBe(true);
    expect(usesFitContentHeight("domain-close-confirm")).toBe(true);
    expect(usesFitContentHeight("split-view")).toBe(true);
    expect(usesFitContentHeight("actions")).toBe(false);
    expect(usesFitContentHeight("last-visited")).toBe(false);
  });

  it("resizes list views from shell height and deduplicates identical measurements", async () => {
    let currentView: ViewId = "last-visited";
    let alive = true;
    const resizePanel = vi.fn();
    const controller = createNativePalettePanelController({
      tick: async () => {},
      getCurrentView: () => currentView,
      isAlive: () => alive,
      getElementById: () => null,
      setTimeout: immediateTimeout,
      resizePanel,
    });

    controller.handlePaletteHeightChange(420);
    await Promise.resolve();
    await Promise.resolve();
    await controller.requestPanelResize();
    await controller.requestPanelResize();

    expect(resizePanel).toHaveBeenCalledTimes(1);
    expect(resizePanel).toHaveBeenCalledWith("last-visited", 420, 0);

    alive = false;
    currentView = "actions";
    controller.handlePaletteHeightChange(500);
    await Promise.resolve();

    expect(resizePanel).toHaveBeenCalledTimes(1);
  });

  it("uses natural content height for compact views", async () => {
    const resizePanel = vi.fn();
    const controller = createNativePalettePanelController({
      tick: async () => {},
      getCurrentView: () => "profiles",
      isAlive: () => true,
      getElementById: () => ({
        scrollHeight: 360,
        getBoundingClientRect: () => ({ height: 385 }),
      } as Pick<HTMLElement, "scrollHeight" | "getBoundingClientRect">),
      setTimeout: immediateTimeout,
      resizePanel,
    });

    await controller.requestPanelResize("profiles");

    expect(resizePanel).toHaveBeenCalledWith("profiles", 385, 0);
  });

  it("resizes again when a dynamic sidebar starts taking extra width", async () => {
    const resizePanel = vi.fn();
    const controller = createNativePalettePanelController({
      tick: async () => {},
      getCurrentView: () => "recently-closed",
      isAlive: () => true,
      getElementById: () => null,
      setTimeout: immediateTimeout,
      resizePanel,
    });

    controller.handlePaletteHeightChange(420);
    await flushPanelResize();
    expect(resizePanel).toHaveBeenCalledTimes(1);

    controller.handlePaletteHeightChange(420, 223);
    await flushPanelResize();

    expect(resizePanel).toHaveBeenCalledTimes(2);
    expect(resizePanel).toHaveBeenNthCalledWith(1, "recently-closed", 420, 0);
    expect(resizePanel).toHaveBeenNthCalledWith(2, "recently-closed", 420, 223);
  });

  it("keeps fit-content height stable when only the dynamic sidebar width changes", async () => {
    let naturalHeight = 326;
    const resizePanel = vi.fn();
    const controller = createNativePalettePanelController({
      tick: async () => {},
      getCurrentView: () => "duplicate-prompt",
      isAlive: () => true,
      getElementById: () => ({
        scrollHeight: naturalHeight,
        getBoundingClientRect: () => ({ height: naturalHeight }),
      } as Pick<HTMLElement, "scrollHeight" | "getBoundingClientRect">),
      setTimeout: immediateTimeout,
      resizePanel,
    });

    await controller.requestPanelResize("duplicate-prompt");
    naturalHeight = 340;
    controller.handlePaletteHeightChange(340, 210);
    await flushPanelResize();
    naturalHeight = 377;
    controller.handlePaletteHeightChange(377, 210);
    await flushPanelResize();
    naturalHeight = 369;
    controller.handlePaletteHeightChange(369, 210);
    await flushPanelResize();
    naturalHeight = 326;
    controller.handlePaletteHeightChange(326, 210);
    await flushPanelResize();

    expect(resizePanel).toHaveBeenCalledTimes(2);
    expect(resizePanel).toHaveBeenNthCalledWith(1, "duplicate-prompt", 326, 0);
    expect(resizePanel).toHaveBeenNthCalledWith(2, "duplicate-prompt", 326, 210);
  });
});
