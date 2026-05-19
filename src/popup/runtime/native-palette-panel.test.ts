import { describe, expect, it, vi } from "vitest";
import { createNativePalettePanelController, usesFitContentHeight } from "./native-palette-panel";
import type { ViewId } from "../../shared/types";

function immediateTimeout(fn: () => void) {
  fn();
  return 1;
}

describe("native palette panel controller", () => {
  it("classifies compact fit-content views", () => {
    expect(usesFitContentHeight("profiles")).toBe(true);
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
    expect(resizePanel).toHaveBeenCalledWith("last-visited", 420);

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

    expect(resizePanel).toHaveBeenCalledWith("profiles", 385);
  });
});
