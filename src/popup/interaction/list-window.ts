export const DEFAULT_LIST_WINDOW_LIMIT = 80;
export const DEFAULT_SELECTION_LOOKBEHIND = 20;
export const MIN_VISIBLE_RANGE_LIMIT = 60;
export const DEFAULT_ROW_HEIGHT = 48;

export function relativeWindowIndex(index: number, offset: number) {
  const relativeIndex = index - offset;
  return relativeIndex >= 0 ? relativeIndex : null;
}

export function rowInWindow<T>(rows: readonly T[], offset: number, index: number) {
  const relativeIndex = relativeWindowIndex(index, offset);
  return relativeIndex === null ? null : rows[relativeIndex] ?? null;
}

export function listWindowContainsIndex(options: {
  index: number;
  offset: number;
  rowCount: number;
}) {
  return options.index >= options.offset && options.index < options.offset + options.rowCount;
}

export function loadWindowForIndex(options: {
  index: number;
  offset: number;
  rowCount: number;
  lookbehind?: number;
  limit?: number;
}) {
  if (options.index < 0) return null;
  if (listWindowContainsIndex(options)) return null;
  return {
    offset: Math.max(0, options.index - (options.lookbehind ?? DEFAULT_SELECTION_LOOKBEHIND)),
    limit: options.limit ?? DEFAULT_LIST_WINDOW_LIMIT,
  };
}

export function visibleRangeRequest(offset: number, limit: number) {
  return {
    offset: Math.max(0, offset),
    limit: Math.max(MIN_VISIBLE_RANGE_LIMIT, limit),
  };
}

export function scrollTopForIndex(options: {
  index: number;
  scrollTop: number;
  clientHeight: number;
  rowHeight?: number;
  paddingTop?: number;
  paddingBottom?: number;
}) {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const paddingTop = options.paddingTop ?? 0;
  const paddingBottom = options.paddingBottom ?? 0;
  const top = paddingTop + Math.max(0, options.index) * rowHeight;
  const bottom = top + rowHeight;
  if (top < options.scrollTop + paddingTop) return Math.max(0, top - paddingTop);
  if (bottom > options.scrollTop + options.clientHeight - paddingBottom) {
    return bottom - options.clientHeight + paddingBottom;
  }
  return options.scrollTop;
}
