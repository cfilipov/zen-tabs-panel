export type DuplicatePromptAction =
  | "duplicate-switch"
  | "duplicate-open-anyway"
  | "duplicate-open-and-close-others"
  | "hide-palette";

export type DuplicatePromptOption = {
  label: string;
  hotkey: string;
  action: DuplicatePromptAction;
  icon: string;
};

export const DUPLICATE_PROMPT_OPTIONS: readonly DuplicatePromptOption[] = [
  { label: "Switch to existing tab", hotkey: "1", action: "duplicate-switch", icon: "svg:arrow-right" },
  { label: "Open anyway", hotkey: "O", action: "duplicate-open-anyway", icon: "svg:plus" },
  { label: "Open and close others", hotkey: "W", action: "duplicate-open-and-close-others", icon: "svg:copy" },
  { label: "Cancel", hotkey: "C", action: "hide-palette", icon: "svg:x-circle" },
];

export const DUPLICATE_PROMPT_ACTIONS: readonly DuplicatePromptAction[] =
  DUPLICATE_PROMPT_OPTIONS.map((option) => option.action);

export function duplicatePromptActionForHotkey(key: string): DuplicatePromptAction | null {
  const option = DUPLICATE_PROMPT_OPTIONS.find((candidate) => candidate.hotkey === key.toUpperCase());
  return option?.action ?? null;
}
