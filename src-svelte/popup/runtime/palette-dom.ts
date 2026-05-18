import type { BridgeKeyData } from "../chord-bridge";
import { naturalPanelHeight } from "../interaction/panel-measure";
import { scrollTopForIndex } from "../interaction/list-window";

export function snapshotKeyEvent(event: KeyboardEvent): BridgeKeyData {
  return {
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
}

export function measurePaletteNaturalHeight(doc: Document = document) {
  const header = doc.getElementById("header");
  const list = doc.getElementById("list");
  const indicator = doc.getElementById("page-indicator");
  const children = list?.children ?? [];
  let listFirstTop: number | null = null;
  let listLastBottom: number | null = null;

  if (children.length > 0) {
    const first = children[0].getBoundingClientRect();
    const last = children[children.length - 1].getBoundingClientRect();
    listFirstTop = first.top;
    listLastBottom = last.bottom;
  }

  const headerVisible = !!header && !header.classList.contains("hidden") && header.children.length > 0;
  const indicatorVisible = !!indicator && !indicator.classList.contains("hidden");

  return naturalPanelHeight({
    listFirstTop,
    listLastBottom,
    headerVisible,
    headerHeight: headerVisible ? header.getBoundingClientRect().height : 0,
    indicatorVisible,
    indicatorHeight: indicatorVisible ? indicator.getBoundingClientRect().height : 0,
  });
}

export function scrollPaletteListIndexIntoView(
  index: number,
  doc: Document = document,
  raf: (callback: FrameRequestCallback) => number = requestAnimationFrame,
) {
  raf(() => {
    const list = doc.getElementById("list");
    if (!list) return;
    list.scrollTop = scrollTopForIndex({
      index,
      scrollTop: list.scrollTop,
      clientHeight: list.clientHeight,
    });
  });
}
