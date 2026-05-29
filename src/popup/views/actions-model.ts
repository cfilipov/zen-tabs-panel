import type { ACTION_SECTIONS } from "../../shared/action-sections";
import type { ViewId } from "../../shared/types";
import type { ActionPreview } from "../runtime/tab-index-client";

export type ActionSectionId = (typeof ACTION_SECTIONS)[number]["id"];

export type ActionMenuItem = {
  id: string;
  kind: "action" | "open-view" | "prefix" | "workspace-switch";
  view?: string;
  workspaceId?: string;
  workspaceIndex?: number;
  workspaceIconHtml?: string;
  count?: number;
  label: string;
  icon?: string;
  iconHtml?: string | null;
  hotkey: string;
  badge: string;
  chordPathBadge?: string;
  searchText?: string;
  isView: boolean;
  page: number;
  disabled?: boolean;
  preview?: ActionPreview | null;
  selected?: boolean;
};

export type ActionSection = {
  id: ActionSectionId;
  label: string;
  page: number;
  navigateGrid?: boolean;
  column?: boolean;
  stack?: boolean;
  scrollable?: boolean;
  items: ActionMenuItem[];
};

export function actionItemsForPage(sections: readonly ActionSection[], page: number): ActionMenuItem[] {
  return sections
    .filter((section) => section.page === page)
    .flatMap((section) => section.items);
}

export function actionSelectionItemsForView(
  view: ViewId,
  visibleActionItems: readonly ActionMenuItem[],
  visibleCommandItems: readonly ActionMenuItem[],
): readonly ActionMenuItem[] {
  return view === "command-palette" ? visibleCommandItems : visibleActionItems;
}

export function applyActionSelection(
  sections: readonly ActionSection[],
  selectedId: string | null,
): ActionSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      selected: selectedId !== null && item.id === selectedId,
    })),
  }));
}
