import { NAVIGATION_TREE, displayKey } from "../../shared/navigation-tree";
import type { NavNode, PrefixNode, TerminalNode, ViewId } from "../../shared/types";
import type { ActionPreview } from "../runtime/tab-index-client";
import type { WorkspaceRow } from "../runtime/workspace-client";

export type ActionSectionId =
  | "navigate"
  | "this-tab"
  | "tab-actions"
  | "all-tabs"
  | "organize"
  | "workspaces"
  | "this-page"
  | "tab"
  | "profiles"
  | "developer"
  | "browser"
  | "page-tools"
  | "other";

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

const sections: Array<Omit<ActionSection, "items"> & { actionIds: string[] }> = [
  { id: "navigate", label: "Navigate", page: 1, navigateGrid: true, actionIds: ["go-to-previous-tab", "go-to-parent-tab", "go-to-prev-vertical-tab", "go-to-next-vertical-tab"] },
  { id: "this-tab", label: "This tab", page: 1, column: true, actionIds: ["tab-info", "navigation", "child-tabs", "sibling-tabs"] },
  { id: "tab-actions", label: "Tab actions", page: 1, column: true, stack: true, actionIds: ["restore-last-closed-tab", "unload-tab", "close-and-select"] },
  { id: "all-tabs", label: "All tabs", page: 1, column: true, actionIds: ["parent-tabs", "unvisited-tabs", "last-visited", "recently-closed", "duplicates", "domains", "tabs-by-age", "most-visited"] },
  { id: "organize", label: "Organize", page: 1, column: true, actionIds: ["toggle-pin-tab", "move-tab-to-start", "move-tab-to-end", "reorder-tabs", "move-to-workspace", "move-to-folder", "scroll-to-current-tab", "split-view"] },
  { id: "workspaces", label: "Workspaces", page: 1, column: true, scrollable: true, actionIds: ["go-to-prev-workspace", "go-to-next-workspace"] },
  { id: "navigate", label: "Navigate", page: 2, navigateGrid: true, actionIds: ["go-back-in-tab", "go-forward-in-tab", "unvisited-newest", "unvisited-oldest"] },
  { id: "this-page", label: "This page", page: 2, column: true, actionIds: ["reload-tab", "reload-skip-cache", "duplicate-tab", "toggle-reader-mode", "toggle-mute", "toggle-fullscreen", "toggle-pip"] },
  { id: "tab", label: "Tab", page: 2, column: true, actionIds: ["reset-pinned-tab", "replace-pinned-url", "add-to-essentials", "open-in-container"] },
  { id: "profiles", label: "Profiles", page: 2, column: true, stack: true, actionIds: ["profiles"] },
  { id: "developer", label: "Developer", page: 2, column: true, actionIds: ["toggle-devtools", "toggle-browser-toolbox"] },
  { id: "browser", label: "Browser", page: 2, column: true, stack: true, actionIds: ["open-downloads", "open-addons", "open-firefox-view"] },
  { id: "page-tools", label: "Page tools", page: 2, column: true, actionIds: ["view-page-source", "view-page-info", "take-screenshot", "copy-url", "copy-url-markdown"] },
  { id: "other", label: "Other", page: 2, column: true, stack: true, actionIds: ["replay-last-chord", "open-options"] },
];

function flatten(nodes: readonly NavNode[]): NavNode[] {
  const out: NavNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.kind === "prefix") out.push(...node.children);
  }
  return out;
}

const nodeById = new Map(flatten(NAVIGATION_TREE).map((node) => [node.id, node]));

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

export function buildActionsMenuModel(disabledIds: ReadonlySet<string> = new Set()): ActionSection[] {
  return sections.map((section) => ({
    id: section.id,
    label: section.label,
    page: section.page,
    navigateGrid: section.navigateGrid,
    column: section.column,
    stack: section.stack,
    scrollable: section.scrollable,
    items: section.actionIds.map((id) => {
      const node = nodeById.get(id);
      if (!node) throw new Error(`Missing navigation node: ${id}`);
      return itemFromNode(node, section.page, disabledIds.has(node.id));
    }),
  }));
}

export function actionItemsForPage(sections: readonly ActionSection[], page: number): ActionMenuItem[] {
  return sections
    .filter((section) => section.page === page)
    .flatMap((section) => section.items);
}

export function actionNodesForSections(sections: readonly ActionSection[]): TerminalNode[] {
  return sections
    .flatMap((section) => section.items)
    .filter((item) => item.kind !== "workspace-switch")
    .map((item) => {
      const node = nodeById.get(item.id);
      if (!node) throw new Error(`Missing navigation node: ${item.id}`);
      return node;
    });
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

export function prefixChildNodesForView(view: ViewId): TerminalNode[] {
  return [...(prefixNodeForView(view)?.children ?? [])];
}

export function appendWorkspaceSwitchItems(
  sections: readonly ActionSection[],
  workspaces: readonly WorkspaceRow[],
  tabCounts: Readonly<Record<string, number>>,
): ActionSection[] {
  return sections.map((section) => {
    if (section.id !== "workspaces" || section.page !== 1) {
      return { ...section, items: [...section.items] };
    }
    const workspaceItems: ActionMenuItem[] = workspaces.map((workspace, index) => ({
      id: `workspace-switch:${workspace.uuid}`,
      kind: "workspace-switch",
      workspaceId: workspace.uuid,
      workspaceIndex: index,
      workspaceIconHtml: workspace.svgContent,
      label: workspace.name,
      hotkey: index < 9 ? String(index + 1) : "",
      badge: index < 9 ? String(index + 1) : "",
      isView: false,
      page: section.page,
      disabled: workspace.isActive,
      count: tabCounts[workspace.uuid] || 0,
    }));
    return { ...section, items: [...section.items, ...workspaceItems] };
  });
}

export function applyActionMetadata(
  sections: readonly ActionSection[],
  counts: Readonly<Record<string, number>>,
  disabledIds: ReadonlySet<string>,
  iconHtmlById: Readonly<Record<string, string | null>> = {},
  previewsById: Readonly<Record<string, ActionPreview | null>> = {},
): ActionSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      iconHtml: iconHtmlById[item.id] ?? item.iconHtml,
      count: item.kind === "workspace-switch" ? item.count : counts[item.id] || 0,
      disabled: item.disabled || disabledIds.has(item.id),
      preview: previewsById[item.id] ?? item.preview,
    })),
  }));
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
