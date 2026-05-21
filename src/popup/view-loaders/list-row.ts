import type { DomainIndexRow, TabIndexRow } from "../runtime/tab-index-client";
import type { NativeListRow } from "./list-loader";

export function isDomainRow(row: NativeListRow | null): row is DomainIndexRow {
  return row?.kind === "domain";
}

export function isTabRow(row: NativeListRow | null): row is TabIndexRow {
  return !!row && row.kind !== "domain";
}
