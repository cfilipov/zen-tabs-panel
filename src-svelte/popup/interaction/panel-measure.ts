export type PanelHeightParts = {
  listFirstTop?: number | null;
  listLastBottom?: number | null;
  headerHeight?: number;
  headerVisible?: boolean;
  indicatorHeight?: number;
  indicatorVisible?: boolean;
  listPadding?: number;
};

export function naturalPanelHeight(parts: PanelHeightParts) {
  const listPadding = parts.listPadding ?? 8;
  const listFirstTop = parts.listFirstTop;
  const listLastBottom = parts.listLastBottom;
  const hasListBounds = typeof listFirstTop === "number" && typeof listLastBottom === "number";
  const listContentHeight = hasListBounds
    ? listPadding + Math.max(0, listLastBottom - listFirstTop)
    : listPadding;
  const headerHeight = parts.headerVisible ? parts.headerHeight ?? 0 : 0;
  const indicatorHeight = parts.indicatorVisible ? parts.indicatorHeight ?? 0 : 0;
  return listContentHeight + headerHeight + indicatorHeight;
}
