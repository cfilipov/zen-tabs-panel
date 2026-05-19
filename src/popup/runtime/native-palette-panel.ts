import type { ViewId } from "../../shared/types";
import { isNativePrefixView } from "../view-loaders/view-registry";

type MaybePromise<T> = T | Promise<T>;

export function usesFitContentHeight(view: ViewId) {
  return isNativePrefixView(view) ||
    view === "move-to-workspace" ||
    view === "move-to-folder" ||
    view === "open-in-container" ||
    view === "profiles" ||
    view === "duplicate-prompt";
}

export type NativePalettePanelControllerDeps = {
  tick: () => Promise<void>;
  getCurrentView: () => ViewId;
  isAlive: () => boolean;
  getElementById: (id: string) => Pick<HTMLElement, "scrollHeight" | "getBoundingClientRect"> | null;
  setTimeout: (fn: () => void, ms: number) => number;
  resizePanel: (view: ViewId, height: number) => MaybePromise<unknown>;
};

export function createNativePalettePanelController(deps: NativePalettePanelControllerDeps) {
  let paletteHeight = 0;
  let resizeRequestId = 0;
  let lastResizeKey = "";

  async function waitMeasureTurn() {
    await new Promise<void>((resolve) => {
      deps.setTimeout(resolve, 0);
    });
  }

  async function requestPanelResize(view: ViewId = deps.getCurrentView()) {
    const requestId = ++resizeRequestId;
    const resizeView = view;
    await deps.tick();
    if (!deps.isAlive() || requestId !== resizeRequestId) return;
    await waitMeasureTurn();
    if (!deps.isAlive() || requestId !== resizeRequestId) return;
    if (usesFitContentHeight(resizeView)) {
      await waitMeasureTurn();
      if (!deps.isAlive() || requestId !== resizeRequestId) return;
    }
    const paletteElement = deps.getElementById("palette");
    const measuredHeight = usesFitContentHeight(resizeView)
      ? Math.max(
        paletteElement?.scrollHeight ?? 0,
        paletteElement?.getBoundingClientRect().height ?? 0,
        paletteHeight,
      )
      : paletteHeight;
    if (!deps.isAlive() || measuredHeight <= 0) return;
    const resizeKey = `${resizeView}:${measuredHeight}`;
    if (resizeKey === lastResizeKey) return;
    lastResizeKey = resizeKey;
    await deps.resizePanel(resizeView, measuredHeight);
  }

  function handlePaletteHeightChange(height: number) {
    paletteHeight = height;
    void requestPanelResize();
  }

  function invalidate() {
    resizeRequestId++;
  }

  return {
    requestPanelResize,
    handlePaletteHeightChange,
    invalidate,
  };
}
