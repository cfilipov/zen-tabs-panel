import { NAVIGATION_TREE } from "../../shared/navigation-tree";
import type { NavNode, TerminalNode, ViewId } from "../../shared/types";
import { chordFromKey, type InteractionInput } from "./inputs";

export type InteractionContext = {
  view: ViewId;
  treePath?: string[];
};

export type InteractionCommand =
  | { kind: "none" }
  | { kind: "action"; actionId: string; source: "tree" | "view" | "mouse" }
  | { kind: "open-view"; view: ViewId; source: "tree" | "view" | "mouse" }
  | { kind: "enter-prefix"; view: ViewId; path: string[]; source: "tree" | "view" }
  | { kind: "cancel" }
  | { kind: "back" }
  | { kind: "move-selection"; delta: 1 | -1 }
  | { kind: "activate-selection" }
  | { kind: "activate-row"; index: number }
  | { kind: "cycle-page"; delta: 1 | -1 };

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
    case " ":
      return context.view === "actions" ? { kind: "cycle-page", delta: input.shiftKey ? -1 : 1 } : { kind: "none" };
    case "ArrowDown":
      return { kind: "move-selection", delta: 1 };
    case "ArrowUp":
      return { kind: "move-selection", delta: -1 };
    case "Enter":
      return { kind: "activate-selection" };
    default:
      if (context.view !== "actions" && /^[1-9]$/.test(input.key) && !input.shiftKey) {
        return { kind: "activate-row", index: Number(input.key) - 1 };
      }
      return { kind: "none" };
  }
}
