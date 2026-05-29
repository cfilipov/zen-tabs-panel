import type { ActionMenuItem } from "../views/actions-model";

type RankedCommand = {
  item: ActionMenuItem;
  prefix: boolean;
  contiguous: boolean;
  gapCount: number;
  firstIndex: number;
  sourceIndex: number;
};

function searchableText(item: ActionMenuItem) {
  return (item.searchText || item.label || "").toLowerCase();
}

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function rankedMatch(item: ActionMenuItem, query: string, sourceIndex: number): RankedCommand | null {
  const haystack = searchableText(item);
  if (!query) {
    return { item, prefix: true, contiguous: true, gapCount: 0, firstIndex: 0, sourceIndex };
  }

  const contiguousIndex = haystack.indexOf(query);
  const positions: number[] = [];
  let cursor = 0;
  for (const char of query) {
    const next = haystack.indexOf(char, cursor);
    if (next < 0) return null;
    positions.push(next);
    cursor = next + 1;
  }

  const firstIndex = positions[0] ?? 0;
  const span = (positions[positions.length - 1] ?? firstIndex) - firstIndex + 1;
  return {
    item,
    prefix: haystack.startsWith(query),
    contiguous: contiguousIndex >= 0,
    gapCount: span - query.length,
    firstIndex,
    sourceIndex,
  };
}

export function filterCommands(items: readonly ActionMenuItem[], query: string): ActionMenuItem[] {
  const normalized = normalizeQuery(query);
  return items
    .map((item, index) => rankedMatch(item, normalized, index))
    .filter((match): match is RankedCommand => !!match)
    .sort((a, b) => {
      if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
      if (a.contiguous !== b.contiguous) return a.contiguous ? -1 : 1;
      if (a.gapCount !== b.gapCount) return a.gapCount - b.gapCount;
      if (a.firstIndex !== b.firstIndex) return a.firstIndex - b.firstIndex;
      return a.sourceIndex - b.sourceIndex;
    })
    .map((match) => match.item);
}
