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

function verticalPadding(element: HTMLElement) {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const paddingTop = Number.parseFloat(style?.paddingTop || "0") || 0;
  const paddingBottom = Number.parseFloat(style?.paddingBottom || "0") || 0;
  return { paddingTop, paddingBottom };
}

export function scrollPaletteListIndexIntoView(
  index: number,
  doc: Document = document,
  raf: (callback: FrameRequestCallback) => number = requestAnimationFrame,
) {
  const apply = () => {
    const list = doc.getElementById("list");
    if (!list) return;
    list.scrollTop = scrollTopForIndex({
      index,
      scrollTop: list.scrollTop,
      clientHeight: list.clientHeight,
      ...verticalPadding(list),
    });
  };
  apply();
  raf(apply);
}

function nearestScrollableAncestor(element: HTMLElement, root: HTMLElement | null) {
  let node: HTMLElement | null = element.parentElement;
  while (node && node !== root?.parentElement) {
    if (node === root) return node;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    const scrollableByStyle = style?.overflowY === "auto" || style?.overflowY === "scroll";
    const scrollableByRole = node.classList.contains("section-scroll");
    if ((scrollableByStyle || scrollableByRole) && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return root;
}

export function scrollSelectedItemIntoView(
  doc: Document = document,
  raf: (callback: FrameRequestCallback) => number = requestAnimationFrame,
) {
  raf(() => {
    const selected = doc.querySelector<HTMLElement>(".list-item.selected");
    const list = doc.getElementById("list");
    if (!selected || !list) return;

    const scroller = nearestScrollableAncestor(selected, list);
    if (!scroller) return;

    const itemRect = selected.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    if (itemRect.top < scrollRect.top) {
      scroller.scrollTop -= scrollRect.top - itemRect.top;
    } else if (itemRect.bottom > scrollRect.bottom) {
      scroller.scrollTop += itemRect.bottom - scrollRect.bottom;
    }
  });
}

function isSelectableListItem(element: HTMLElement) {
  return !element.classList.contains("disabled") && !element.hasAttribute("disabled");
}

export function directionalListItemId(
  delta: 1 | -1,
  options: { currentPage?: number; doc?: Document } = {},
) {
  const doc = options.doc ?? document;
  const root = options.currentPage
    ? doc.querySelector<HTMLElement>(`.actions-page[data-page="${options.currentPage}"]`)
    : doc.getElementById("list");
  if (!root) return null;

  const items = Array.from(root.querySelectorAll<HTMLElement>(".list-item"))
    .filter(isSelectableListItem);
  if (items.length === 0) return null;

  const selected = root.querySelector<HTMLElement>(".list-item.selected");
  if (!selected || !items.includes(selected)) {
    return items[0]?.dataset.id ?? null;
  }

  const currentRect = selected.getBoundingClientRect();
  if (currentRect.width === 0 || currentRect.height === 0) return null;
  const currentX = currentRect.left + currentRect.width / 2;
  const currentY = currentRect.top + currentRect.height / 2;
  const directionThreshold = 8;

  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item === selected) continue;
    const rect = item.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const itemX = rect.left + rect.width / 2;
    const itemY = rect.top + rect.height / 2;
    if (delta > 0 && itemX <= currentX + directionThreshold) continue;
    if (delta < 0 && itemX >= currentX - directionThreshold) continue;

    const primary = Math.abs(itemX - currentX);
    const cross = Math.abs(itemY - currentY);
    const score = primary + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best?.dataset.id ?? null;
}
