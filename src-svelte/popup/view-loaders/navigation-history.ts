import type { NavigationEntry, NavigationHistory } from "../runtime/history-client";

export function isNewTabUrl(url: string | null | undefined) {
  return !url || url === "about:newtab" || url === "about:blank" || url === "about:home";
}

export function filterNavigationHistory(history: NavigationHistory | null): NavigationHistory | null {
  if (!history) return null;
  const entries: NavigationEntry[] = history.entries
    .map((entry, historyIndex) => ({ ...entry, historyIndex: entry.historyIndex ?? historyIndex }))
    .filter((entry) => !isNewTabUrl(entry.url));
  const index = entries.findIndex((entry) => entry.historyIndex === history.index);
  return { entries, index };
}
