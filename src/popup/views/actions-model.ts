import type { ACTION_SECTIONS } from "../../shared/action-sections";
import { NAVIGATION_TREE, displayKey } from "../../shared/navigation-tree";
import type { NavNode, PrefixNode, TerminalNode, ViewId } from "../../shared/types";
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

function itemFromNode(node: TerminalNode, page = 1, disabled = false): ActionMenuItem {
  return {
    id: node.id,
    kind: node.kind,
    view: node.kind === "open-view" || node.kind === "prefix" ? node.view : undefined,
    label: node.label,
    icon: node.icon,
    hotkey: node.chord,
    badge: displayKey(node.chord),
    isView: node.kind === "open-view" || node.kind === "prefix",
    page,
    disabled,
  };
}

export function actionItemsForPage(sections: readonly ActionSection[], page: number): ActionMenuItem[] {
  return sections
    .filter((section) => section.page === page)
    .flatMap((section) => section.items);
}

export function prefixNodeForView(view: ViewId): PrefixNode | null {
  const node = (NAVIGATION_TREE as readonly NavNode[]).find((candidate) =>
    candidate.kind === "prefix" && candidate.view === view
  );
  return node && node.kind === "prefix" ? node : null;
}

export function prefixItemsForView(view: ViewId): ActionMenuItem[] {
  return prefixNodeForView(view)?.children.map((node) => itemFromNode(node)) ?? [];
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
