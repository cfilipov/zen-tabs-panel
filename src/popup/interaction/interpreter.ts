import type { ViewId } from "../../shared/types";
import { duplicatePromptActionForHotkey, type DuplicatePromptAction } from "./duplicate-prompt-options";
import type { InteractionInput } from "./inputs";
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
  | { kind: "activate-selection-and-switch" }
  | { kind: "activate-row"; index: number }
  | { kind: "activate-row-and-switch"; index: number }
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

export function interpretStructuralInput(
  input: Extract<InteractionInput, { kind: "key" }>,
  context: InteractionContext,
): InteractionCommand {
  return interpretStructuralKey(input, context);
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
    resolve: (input, context) => {
      if (input.key !== "Enter") return noCommand;
      if (input.shiftKey && isMoveAndSwitchView(context.view)) return { kind: "activate-selection-and-switch" };
      return { kind: "activate-selection" };
    },
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
    id: "activate-row-index-and-switch",
    resolve: (input, context) => {
      if (!plainKey(input) || !isMoveAndSwitchView(context.view)) return noCommand;
      const index = shiftedDigitCodeIndex(input);
      return index === null ? noCommand : { kind: "activate-row-and-switch", index };
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

function isMoveAndSwitchView(view: ViewId) {
  return view === "move-to-workspace" || view === "move-to-folder";
}

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
