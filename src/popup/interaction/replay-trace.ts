import type { NavigationHistory } from "../runtime/history-client";
import type { ViewId } from "../../shared/types";
import { isNativePrefixView } from "../view-loaders/view-registry";

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

export function replayKeyForSelection(options: {
  view: ViewId;
  selectedIndex: number;
  navigationHistory: NavigationHistory | null;
  shifted?: boolean;
}) {
  if (options.view === "actions" || isNativePrefixView(options.view)) return null;
  if (options.view === "navigation") {
    return replayKeyForNavigationIndex(options.navigationHistory, options.selectedIndex);
  }
  return replayKeyForBadgeIndex(options.selectedIndex, options.shifted);
}
