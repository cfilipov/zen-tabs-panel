import type { ViewId } from "../../shared/types";

const closeableViews = new Set<ViewId>([
  "child-tabs",
  "sibling-tabs",
  "parent-tabs",
  "unvisited-tabs",
  "last-visited",
  "domain-tabs",
  "most-visited",
  "tabs-by-age",
]);

const closeAllViews = new Set<ViewId>(["child-tabs"]);
const restorableViews = new Set<ViewId>(["recently-closed"]);
const sortableViews = new Set<ViewId>(["domains", "domain-tabs", "tabs-by-age"]);
const drillableViews = new Set<ViewId>(["parent-tabs"]);
const workspaceFilterViews = new Set<ViewId>([
  "child-tabs",
  "sibling-tabs",
  "parent-tabs",
  "unvisited-tabs",
  "last-visited",
  "domain-tabs",
  "most-visited",
  "tabs-by-age",
  "domains",
  "duplicates",
]);

export function isCloseableView(view: ViewId) {
  return closeableViews.has(view);
}

export function canCloseAllInView(view: ViewId) {
  return closeAllViews.has(view);
}

export function canRestoreInView(view: ViewId) {
  return restorableViews.has(view);
}

export function isSortableView(view: ViewId) {
  return sortableViews.has(view);
}

export function canDrillSelectionInView(view: ViewId) {
  return drillableViews.has(view);
}

export function isWorkspaceFilterView(view: ViewId | undefined) {
  return !!view && workspaceFilterViews.has(view);
}
