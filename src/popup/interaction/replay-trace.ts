import type { NavigationHistory } from "../runtime/history-client";

export function replayKeyForBadgeIndex(index: number, shifted = false): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= 9) return null;
  const key = String(index + 1);
  return shifted ? `Shift+${key}` : key;
}

export function replayKeyForNavigationIndex(history: NavigationHistory | null, index: number): string | null {
  if (!history || index === history.index || index < 0 || index >= history.entries.length) return null;
  const badgeIndex = history.entries
    .slice(0, index)
    .filter((_, candidateIndex) => candidateIndex !== history.index)
    .length;
  return replayKeyForBadgeIndex(badgeIndex);
}
