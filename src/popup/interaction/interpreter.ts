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
  selectedIndex?: number;
  duplicatePromptActionCount?: number;
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
  | { kind: "move-selection-directional"; delta: 1 | -1 }
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

type StructuralKeyResolver = {
  id: string;
  resolve: (input: Extract<InteractionInput, { kind: "key" }>, context: InteractionContext) => InteractionCommand;
};

const noCommand: InteractionCommand = { kind: "none" };

function commandWhen(condition: boolean, command: InteractionCommand): InteractionCommand {
  return condition ? command : noCommand;
}

function plainKey(input: Extract<InteractionInput, { kind: "key" }>) {
  return !input.metaKey && !input.ctrlKey && !input.altKey;
}

function upperKey(input: Extract<InteractionInput, { kind: "key" }>) {
  return input.key.toUpperCase();
}

function digitKeyIndex(input: Extract<InteractionInput, { kind: "key" }>) {
  return /^[1-9]$/.test(input.key) ? Number(input.key) - 1 : null;
}

function shiftedDigitCodeIndex(input: Extract<InteractionInput, { kind: "key" }>) {
  if (!input.shiftKey || !input.code?.startsWith("Digit")) return null;
  const index = Number.parseInt(input.code.slice("Digit".length), 10) - 1;
  return index >= 0 && index < 9 ? index : null;
}

const structuralKeyResolvers: readonly StructuralKeyResolver[] = [
  {
    id: "cancel",
    resolve: (input) => commandWhen(input.key === "Escape", { kind: "cancel" }),
  },
  {
    id: "back",
    resolve: (input, context) => {
      if (input.key !== "Backspace") return noCommand;
      if (context.view === "duplicate-prompt") return { kind: "cancel" };
      return context.view === "actions" ? { kind: "cancel" } : { kind: "back" };
    },
  },
  {
    id: "jump-section",
    resolve: (input) => commandWhen(input.key === "Tab", { kind: "jump-section", delta: input.shiftKey ? -1 : 1 }),
  },
  {
    id: "move-left-or-back",
    resolve: (input, context) => {
      if (input.key !== "ArrowLeft") return noCommand;
      if (context.view === "duplicate-prompt") return { kind: "cancel" };
      if (context.view === "actions" || context.view === "reorder-tabs" || context.view === "close-and-select") {
        return { kind: "move-selection-directional", delta: -1 };
      }
      return { kind: "back" };
    },
  },
  {
    id: "move-right-or-drill",
    resolve: (input, context) => {
      if (input.key !== "ArrowRight") return noCommand;
      if (context.view === "actions" || context.view === "reorder-tabs" || context.view === "close-and-select") {
        return { kind: "move-selection-directional", delta: 1 };
      }
      return canDrillSelectionInView(context.view) ? { kind: "drill-selection" } : noCommand;
    },
  },
  {
    id: "cycle-page",
    resolve: (input, context) => commandWhen(
      input.key === " " && context.view === "actions",
      { kind: "cycle-page", delta: input.shiftKey ? -1 : 1 },
    ),
  },
  {
    id: "move-down",
    resolve: (input) => commandWhen(input.key === "ArrowDown", { kind: "move-selection", delta: 1 }),
  },
  {
    id: "move-up",
    resolve: (input) => commandWhen(input.key === "ArrowUp", { kind: "move-selection", delta: -1 }),
  },
  {
    id: "activate-selection",
    resolve: (input) => commandWhen(input.key === "Enter", { kind: "activate-selection" }),
  },
  {
    id: "navigation-history-delta",
    resolve: (input, context) => {
      if (!plainKey(input) || input.shiftKey || context.view !== "navigation") return noCommand;
      if (upperKey(input) === "B") return { kind: "navigate-history-delta", delta: -1 };
      if (upperKey(input) === "F") return { kind: "navigate-history-delta", delta: 1 };
      return noCommand;
    },
  },
  {
    id: "close",
    resolve: (input, context) => {
      if (!plainKey(input) || upperKey(input) !== "W") return noCommand;
      if (context.view === "duplicate-prompt") {
        const actionCount = context.duplicatePromptActionCount ?? 0;
        return !input.shiftKey && (context.selectedIndex ?? -1) >= actionCount ? { kind: "close-selection" } : noCommand;
      }
      if (input.shiftKey && canCloseAllInView(context.view)) return { kind: "close-all" };
      if (!input.shiftKey && isCloseableView(context.view)) return { kind: "close-selection" };
      return noCommand;
    },
  },
  {
    id: "duplicate-prompt-action",
    resolve: (input, context) => {
      if (!plainKey(input) || input.shiftKey || context.view !== "duplicate-prompt") return noCommand;
      const action = duplicatePromptActionForHotkey(upperKey(input));
      return action ? { kind: "duplicate-prompt-action", action } : noCommand;
    },
  },
  {
    id: "restore",
    resolve: (input, context) => commandWhen(
      plainKey(input) && !input.shiftKey && upperKey(input) === "O" && canRestoreInView(context.view),
      { kind: "restore-selection-keep-open" },
    ),
  },
  {
    id: "sort",
    resolve: (input, context) => commandWhen(
      plainKey(input) && !input.shiftKey && upperKey(input) === "S" && isSortableView(context.view),
      { kind: "toggle-sort" },
    ),
  },
  {
    id: "toggle-workspace-filter",
    resolve: (input, context) => commandWhen(
      plainKey(input) && !input.shiftKey && input.key === "0" && isWorkspaceFilterView(context.view),
      { kind: "toggle-workspace-filter" },
    ),
  },
  {
    id: "filter-workspace-index",
    resolve: (input, context) => {
      if (!plainKey(input) || !isWorkspaceFilterView(context.view)) return noCommand;
      const index = shiftedDigitCodeIndex(input);
      return index === null ? noCommand : { kind: "filter-workspace-index", index };
    },
  },
  {
    id: "activate-row-index",
    resolve: (input, context) => {
      if (context.view === "actions" || input.shiftKey) return noCommand;
      const index = digitKeyIndex(input);
      return index === null ? noCommand : { kind: "activate-row", index };
    },
  },
  {
    id: "switch-workspace-index",
    resolve: (input, context) => {
      if (context.view !== "actions" || input.shiftKey) return noCommand;
      const index = digitKeyIndex(input);
      return index === null ? noCommand : { kind: "switch-workspace-index", index };
    },
  },
  {
    id: "open-extension-index",
    resolve: (input, context) => {
      if (context.view !== "actions") return noCommand;
      const index = shiftedDigitCodeIndex(input);
      return index === null ? noCommand : { kind: "open-extension-index", index };
    },
  },
];

export function interpretStructuralKey(
  input: InteractionInput,
  context: InteractionContext,
): InteractionCommand {
  if (input.kind !== "key") return { kind: "none" };
  for (const resolver of structuralKeyResolvers) {
    const command = resolver.resolve(input, context);
    if (command.kind !== "none") return command;
  }
  return noCommand;
}
