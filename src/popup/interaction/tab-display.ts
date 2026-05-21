import type { ViewId } from "../../shared/types";
import type { TabIndexRow } from "../runtime/tab-index-client";

export function tabAgeLabel(row: TabIndexRow, now: number, formatDuration: (durationMs: number) => string) {
  const created = Number.parseInt(row.domId.split("-")[0] || "", 10);
  return formatDuration(now - created);
}

export function tabSubtitleForView(
  view: ViewId,
  row: TabIndexRow,
  options: {
    now: number;
    formatDuration: (durationMs: number) => string;
  },
) {
  if (view === "most-visited") return `${row.focusCount ?? 0} focuses`;
  if (view === "tabs-by-age") return tabAgeLabel(row, options.now, options.formatDuration);
  return null;
}
