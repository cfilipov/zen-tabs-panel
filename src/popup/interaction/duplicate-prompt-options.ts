export type DuplicatePromptAction = "duplicate-switch" | "duplicate-open-anyway" | "hide-palette";

export type DuplicatePromptOption = {
  label: string;
  hotkey: string;
  action: DuplicatePromptAction;
  icon: string;
};

export const DUPLICATE_PROMPT_OPTIONS: readonly DuplicatePromptOption[] = [
  { label: "Switch to existing tab", hotkey: "S", action: "duplicate-switch", icon: "svg:arrow-right" },
  { label: "Open anyway", hotkey: "O", action: "duplicate-open-anyway", icon: "svg:plus" },
  { label: "Cancel", hotkey: "C", action: "hide-palette", icon: "svg:x-circle" },
];

export const DUPLICATE_PROMPT_ACTIONS: readonly DuplicatePromptAction[] =
  DUPLICATE_PROMPT_OPTIONS.map((option) => option.action);

export function duplicatePromptActionForHotkey(key: string): DuplicatePromptAction | null {
  const option = DUPLICATE_PROMPT_OPTIONS.find((candidate) => candidate.hotkey === key.toUpperCase());
  return option?.action ?? null;
}
