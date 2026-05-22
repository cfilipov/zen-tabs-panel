import type { ViewId } from "../../shared/types";

export function encodeViewParams(params?: URLSearchParams | Record<string, unknown>) {
  if (!params) return undefined;
  if (params instanceof URLSearchParams) {
    return JSON.stringify(Object.fromEntries(params.entries()));
  }
  return JSON.stringify(params);
}

export function chromeNavigationMessage(
  view: ViewId,
  params?: URLSearchParams | Record<string, unknown>,
  inst?: number | null,
  readyGen?: number | null,
) {
  if (view === "actions") {
    return { type: "navigate-back" };
  }
  return {
    type: "navigate-view",
    view,
    params: encodeViewParams(params),
    ...(typeof inst === "number" ? { inst } : {}),
    ...(typeof readyGen === "number" ? { readyGen } : {}),
  };
}
