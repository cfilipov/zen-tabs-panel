import type { ViewId } from "../../shared/types";
import {
  canCloseAllInView,
  canDrillSelectionInView,
  canRestoreInView,
  isCloseableView,
  isSearchableView,
  isWorkspaceFilterView,
} from "./view-capabilities";

export type SidebarHintId = "close" | "close-all" | "restore" | "children";

export type SidebarHintModel = {
  id: SidebarHintId;
  label: string;
  badge: string;
  hidden?: boolean;
};

export type SidebarModelContext = {
  view: ViewId;
  selectedIndex: number;
  closeSelectionAvailable?: boolean;
  domainsSortAlpha: boolean;
  tabsByAgeNewestFirst: boolean;
};

export type SidebarModel = {
  hidden: boolean;
  hints: SidebarHintModel[];
  hintsOnly: boolean;
  sortLabel: string | null;
  searchAvailable: boolean;
};

export function buildSidebarModel(context: SidebarModelContext): SidebarModel {
  const hintsOnly = context.view === "recently-closed";
  const sortLabel = sidebarSortLabel(context);
  const searchAvailable = isSearchableView(context.view);
  const hints = sidebarHints(context);
  const visibleHints = hints.filter((hint) => !hint.hidden);
  const hidden = hintsOnly
    ? context.selectedIndex < 0
    : !isWorkspaceFilterView(context.view) && visibleHints.length === 0 && !sortLabel && !searchAvailable;

  return { hidden, hints, hintsOnly, sortLabel, searchAvailable };
}

function sidebarSortLabel(context: SidebarModelContext) {
  if (context.view === "domains") return `Sort by ${context.domainsSortAlpha ? "count" : "A-Z"}`;
  if (context.view === "tabs-by-age") return `Sort by ${context.tabsByAgeNewestFirst ? "oldest" : "newest"}`;
  return null;
}

function sidebarHints(context: SidebarModelContext): SidebarHintModel[] {
  const hints: SidebarHintModel[] = [];
  if (isCloseableView(context.view)) {
    const available = context.closeSelectionAvailable ?? context.selectedIndex >= 0;
    hints.push({
      id: "close",
      label: context.view === "domains" ? "Close domain" : "Close tab",
      badge: "W",
      hidden: !available,
    });
  }
  if (canCloseAllInView(context.view)) {
    hints.push({ id: "close-all", label: "Close all", badge: "⇧W" });
  }
  if (canRestoreInView(context.view)) {
    hints.push({
      id: "restore",
      label: "Restore tab",
      badge: "O",
      hidden: context.selectedIndex < 0,
    });
  }
  if (canDrillSelectionInView(context.view)) {
    hints.push({
      id: "children",
      label: "Show children",
      badge: "→",
      hidden: context.selectedIndex < 0,
    });
  }
  return hints;
}
