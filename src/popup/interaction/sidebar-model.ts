import type { ViewId } from "../../shared/types";
import {
  canCloseAllInView,
  canDrillSelectionInView,
  canRestoreInView,
  isCloseableView,
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
  domainsSortAlpha: boolean;
  tabsByAgeNewestFirst: boolean;
};

export type SidebarModel = {
  hidden: boolean;
  hints: SidebarHintModel[];
  hintsOnly: boolean;
  sortLabel: string | null;
};

export function buildSidebarModel(context: SidebarModelContext): SidebarModel {
  const hintsOnly = context.view === "recently-closed";
  const sortLabel = sidebarSortLabel(context);
  const hints = sidebarHints(context);
  const hidden = hintsOnly
    ? context.selectedIndex < 0
    : !isWorkspaceFilterView(context.view) && hints.length === 0 && !sortLabel;

  return { hidden, hints, hintsOnly, sortLabel };
}

function sidebarSortLabel(context: SidebarModelContext) {
  if (context.view === "domains") return `Sort by ${context.domainsSortAlpha ? "count" : "A-Z"}`;
  if (context.view === "tabs-by-age") return `Sort by ${context.tabsByAgeNewestFirst ? "oldest" : "newest"}`;
  return null;
}

function sidebarHints(context: SidebarModelContext): SidebarHintModel[] {
  const hints: SidebarHintModel[] = [];
  if (isCloseableView(context.view)) {
    hints.push({
      id: "close",
      label: "Close tab",
      badge: "W",
      hidden: context.selectedIndex < 0,
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
