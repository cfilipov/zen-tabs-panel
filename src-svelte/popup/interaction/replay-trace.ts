import type { NavigationHistory } from "../runtime/history-client";

export function replayKeyForBadgeIndex(index: number): string | null {
  return Number.isInteger(index) && index >= 0 && index < 9 ? String(index + 1) : null;
}

export function replayKeyForNavigationIndex(history: NavigationHistory | null, index: number): string | null {
  if (!history || index === history.index || index < 0 || index >= history.entries.length) return null;
  const badgeIndex = history.entries
    .slice(0, index)
    .filter((_, candidateIndex) => candidateIndex !== history.index)
    .length;
  return replayKeyForBadgeIndex(badgeIndex);
}

