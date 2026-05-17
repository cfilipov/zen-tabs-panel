import { NAVIGATION_TREE } from "../../shared/navigation-tree";
import type { NavNode, TerminalNode, ViewId } from "../../shared/types";
import { duplicatePromptActionForHotkey, type DuplicatePromptAction } from "./duplicate-prompt-options";
import { chordFromKey, type InteractionInput } from "./inputs";
import {
  canCloseAllInView,
  canDrillSelectionInView,
  canRestoreInView,
  isCloseableView,
  isSortableView,
  isWorkspaceFilterView,
} from "./view-capabilities";

export type InteractionContext = {
  view: ViewId;
  treePath?: string[];
};

export type InteractionCommand =
  | { kind: "none" }
  | { kind: "action"; actionId: string; source: "tree" | "view" | "mouse" }
  | { kind: "open-view"; view: ViewId; source: "tree" | "view" | "mouse" }
  | { kind: "enter-prefix"; view: ViewId; path: string[]; source: "tree" | "view" }
  | { kind: "duplicate-prompt-action"; action: DuplicatePromptAction }
  | { kind: "navigate-history-delta"; delta: 1 | -1 }
  | { kind: "cancel" }
  | { kind: "back" }
  | { kind: "move-selection"; delta: 1 | -1 }
  | { kind: "jump-section"; delta: 1 | -1 }
  | { kind: "activate-selection" }
  | { kind: "activate-row"; index: number }
  | { kind: "cycle-page"; delta: 1 | -1 }
  | { kind: "close-selection" }
  | { kind: "close-all" }
  | { kind: "restore-selection-keep-open" }
  | { kind: "drill-selection" }
  | { kind: "toggle-sort" }
  | { kind: "toggle-workspace-filter" }
  | { kind: "filter-workspace-index"; index: number }
  | { kind: "switch-workspace-index"; index: number }
  | { kind: "open-extension-index"; index: number };

function commandForNode(node: TerminalNode, source: "tree" | "view" | "mouse"): InteractionCommand {
  if (node.kind === "action") return { kind: "action", actionId: node.id, source };
  if (node.kind === "open-view") return { kind: "open-view", view: node.view, source };
  return { kind: "enter-prefix", view: node.view, path: [node.id], source: source === "mouse" ? "view" : source };
}

function childrenForPath(tree: readonly NavNode[], path: readonly string[]): readonly TerminalNode[] {
  if (path.length === 0) return tree;
  let nodes: readonly NavNode[] = tree;
  let current: NavNode | undefined;
  for (const id of path) {
    current = nodes.find((node) => node.id === id);
    if (!current || current.kind !== "prefix") return [];
    nodes = current.children;
  }
  return nodes;
}

export function interpretTreeInput(
  input: InteractionInput,
  context: InteractionContext,
  tree: readonly NavNode[] = NAVIGATION_TREE,
): InteractionCommand {
  if (input.kind === "mouse") {
    const node = childrenForPath(tree, context.treePath ?? []).find((candidate) => candidate.id === input.targetId);
    return node ? commandForNode(node, "mouse") : { kind: "none" };
  }

  const chord = chordFromKey(input);
  if (!chord) return { kind: "none" };
  const node = childrenForPath(tree, context.treePath ?? []).find((candidate) => candidate.chord === chord);
  return node ? commandForNode(node, "tree") : { kind: "none" };
}

export function interpretVisibleInput(
  input: InteractionInput,
  context: InteractionContext,
  visibleNodes: readonly TerminalNode[],
): InteractionCommand {
  const chord = chordFromKey(input);
  if (input.kind === "mouse") {
    const node = visibleNodes.find((candidate) => candidate.id === input.targetId);
    return node ? commandForNode(node, "mouse") : { kind: "none" };
  }
  if (!chord) return { kind: "none" };
  const node = visibleNodes.find((candidate) => candidate.chord === chord);
  return node ? commandForNode(node, "view") : interpretStructuralKey(input, context);
}

export function interpretStructuralKey(
  input: InteractionInput,
  context: InteractionContext,
): InteractionCommand {
  if (input.kind !== "key") return { kind: "none" };
  switch (input.key) {
    case "Escape":
      return { kind: "cancel" };
    case "Backspace":
      return context.view === "actions" ? { kind: "none" } : { kind: "back" };
    case "Tab":
      return { kind: "jump-section", delta: input.shiftKey ? -1 : 1 };
    case "ArrowLeft":
      return context.view === "actions" ? { kind: "none" } : { kind: "back" };
    case "ArrowRight":
      return canDrillSelectionInView(context.view) ? { kind: "drill-selection" } : { kind: "none" };
    case " ":
      return context.view === "actions" ? { kind: "cycle-page", delta: input.shiftKey ? -1 : 1 } : { kind: "none" };
    case "ArrowDown":
      return { kind: "move-selection", delta: 1 };
    case "ArrowUp":
      return { kind: "move-selection", delta: -1 };
    case "Enter":
      return { kind: "activate-selection" };
    default:
      if (!input.metaKey && !input.ctrlKey && !input.altKey) {
        const upper = input.key.toUpperCase();
        if (context.view === "duplicate-prompt" && !input.shiftKey) {
          const action = duplicatePromptActionForHotkey(upper);
          if (action) return { kind: "duplicate-prompt-action", action };
        }
        if (context.view === "navigation" && !input.shiftKey) {
          if (upper === "B") return { kind: "navigate-history-delta", delta: -1 };
          if (upper === "F") return { kind: "navigate-history-delta", delta: 1 };
        }
        if (upper === "W") {
          if (input.shiftKey && canCloseAllInView(context.view)) return { kind: "close-all" };
          if (!input.shiftKey && isCloseableView(context.view)) return { kind: "close-selection" };
        }
        if (upper === "O" && !input.shiftKey && canRestoreInView(context.view)) {
          return { kind: "restore-selection-keep-open" };
        }
        if (upper === "S" && !input.shiftKey && isSortableView(context.view)) {
          return { kind: "toggle-sort" };
        }
        if (input.key === "0" && !input.shiftKey && isWorkspaceFilterView(context.view)) {
          return { kind: "toggle-workspace-filter" };
        }
        if (input.shiftKey && input.code?.startsWith("Digit") && isWorkspaceFilterView(context.view)) {
          const index = Number.parseInt(input.code.slice("Digit".length), 10) - 1;
          if (index >= 0 && index < 9) return { kind: "filter-workspace-index", index };
        }
      }
      if (context.view !== "actions" && /^[1-9]$/.test(input.key) && !input.shiftKey) {
        return { kind: "activate-row", index: Number(input.key) - 1 };
      }
      if (context.view === "actions" && /^[1-9]$/.test(input.key) && !input.shiftKey) {
        return { kind: "switch-workspace-index", index: Number(input.key) - 1 };
      }
      if (context.view === "actions" && input.shiftKey && input.code?.startsWith("Digit")) {
        const index = Number.parseInt(input.code.slice("Digit".length), 10) - 1;
        if (index >= 0 && index < 9) return { kind: "open-extension-index", index };
      }
      return { kind: "none" };
  }
}
