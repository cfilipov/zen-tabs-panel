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
  resizePanel: (view: ViewId, height: number, dynamicSidebarWidth?: number) => MaybePromise<unknown>;
};

export function createNativePalettePanelController(deps: NativePalettePanelControllerDeps) {
  let paletteHeight = 0;
  let dynamicSidebarWidth = 0;
  let resizeRequestId = 0;
  let lastResizeKey = "";
  let lastResizeView: ViewId | null = null;
  let lastResizeHeight = 0;
  let lastDynamicSidebarWidth = 0;
  let sidebarWidthSettleRequests = 0;

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
    const usesNaturalHeight = usesFitContentHeight(resizeView);
    const measuredHeight = usesNaturalHeight
      ? Math.max(
        paletteElement?.scrollHeight ?? 0,
        paletteElement?.getBoundingClientRect().height ?? 0,
        paletteHeight,
      )
      : paletteHeight;
    if (!deps.isAlive() || measuredHeight <= 0) return;
    const sidebarWidthChanged = dynamicSidebarWidth !== lastDynamicSidebarWidth;
    const freezeHeightForSidebarSettle = usesNaturalHeight &&
      resizeView === lastResizeView &&
      lastResizeHeight > 0 &&
      (sidebarWidthChanged || (sidebarWidthSettleRequests > 0 && dynamicSidebarWidth === lastDynamicSidebarWidth));
    const height = freezeHeightForSidebarSettle
      ? lastResizeHeight
      : measuredHeight;
    if (!sidebarWidthChanged && sidebarWidthSettleRequests > 0) {
      sidebarWidthSettleRequests -= 1;
    }
    const resizeKey = `${resizeView}:${height}:${dynamicSidebarWidth}`;
    if (resizeKey === lastResizeKey) return;
    lastResizeKey = resizeKey;
    lastResizeView = resizeView;
    lastResizeHeight = height;
    lastDynamicSidebarWidth = dynamicSidebarWidth;
    await deps.resizePanel(resizeView, height, dynamicSidebarWidth);
  }

  function handlePaletteHeightChange(height: number, nextDynamicSidebarWidth = 0) {
    paletteHeight = height;
    if (nextDynamicSidebarWidth !== dynamicSidebarWidth) {
      sidebarWidthSettleRequests = 6;
    }
    dynamicSidebarWidth = nextDynamicSidebarWidth;
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
