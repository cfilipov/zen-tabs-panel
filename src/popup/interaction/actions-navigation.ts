export type ActionSectionShape = {
  page: number;
  items: readonly unknown[];
};

export function nextActionsPage(currentPage: number, targetPage: number, pageCount: number) {
  if (pageCount <= 1) return null;
  let nextPage = targetPage;
  if (nextPage < 1) nextPage = pageCount;
  if (nextPage > pageCount) nextPage = 1;
  return nextPage === currentPage ? null : nextPage;
}

export function snappedActionsPage(scrollLeft: number, pageWidth: number, pages: readonly number[]) {
  if (pageWidth <= 0 || pages.length === 0) return null;
  const index = Math.round(scrollLeft / pageWidth);
  return pages[Math.max(0, Math.min(pages.length - 1, index))] ?? null;
}

export function actionSectionStarts(
  sections: readonly ActionSectionShape[],
  currentPage: number,
) {
  const starts: number[] = [];
  let index = 0;
  for (const section of sections) {
    if (section.page !== currentPage) continue;
    if (section.items.length > 0) starts.push(index);
    index += section.items.length;
  }
  return starts;
}

export function nextActionSectionIndex(options: {
  sections: readonly ActionSectionShape[];
  currentPage: number;
  visibleItemCount: number;
  selectedIndex: number;
  delta: 1 | -1;
}) {
  const starts = actionSectionStarts(options.sections, options.currentPage);
  if (!starts.length) return null;
  const currentStartIndex = starts.findIndex((start, i) => {
    const next = starts[i + 1] ?? options.visibleItemCount;
    return options.selectedIndex >= start && options.selectedIndex < next;
  });
  const base = currentStartIndex >= 0 ? currentStartIndex : 0;
  return starts[(base + options.delta + starts.length) % starts.length];
}
