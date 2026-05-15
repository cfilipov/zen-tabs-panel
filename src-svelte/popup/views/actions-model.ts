import { NAVIGATION_TREE, displayKey } from "../../shared/navigation-tree";
import type { NavNode, TerminalNode } from "../../shared/types";

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
  kind: "action" | "open-view" | "prefix";
  view?: string;
  label: string;
  icon?: string;
  hotkey: string;
  badge: string;
  isView: boolean;
  page: number;
  disabled?: boolean;
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
  { id: "tab", label: "Tab", page: 2, column: true, actionIds: ["reset-pinned-tab", "add-to-essentials", "open-in-container"] },
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
      return {
        id: node.id,
        kind: node.kind,
        view: node.kind === "open-view" || node.kind === "prefix" ? node.view : undefined,
        label: node.label,
        icon: node.icon,
        hotkey: node.chord,
        badge: displayKey(node.chord),
        isView: node.kind === "open-view" || node.kind === "prefix",
        page: section.page,
        disabled: disabledIds.has(node.id),
      };
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
    .map((item) => {
      const node = nodeById.get(item.id);
      if (!node) throw new Error(`Missing navigation node: ${item.id}`);
      return node;
    });
}
