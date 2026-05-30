import { hasViewCapability } from "../../shared/navigation-tree";
import type { ViewId } from "../../shared/types";

export function isCloseableView(view: ViewId) {
  return view === "domains" || view === "duplicate-prompt" || hasViewCapability(view, "closeSelection");
}

export function canCloseAllInView(view: ViewId) {
  return hasViewCapability(view, "closeAll");
}

export function canRestoreInView(view: ViewId) {
  return hasViewCapability(view, "restoreSelection");
}

export function isSortableView(view: ViewId) {
  return hasViewCapability(view, "sort");
}

export function isSearchableView(view: ViewId | undefined) {
  return hasViewCapability(view, "search");
}

export function canDrillSelectionInView(view: ViewId) {
  return hasViewCapability(view, "drillSelection");
}

export function isWorkspaceFilterView(view: ViewId | undefined) {
  return hasViewCapability(view, "workspaceFilter");
}
