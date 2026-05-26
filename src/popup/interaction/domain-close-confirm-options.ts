export type DomainCloseConfirmAction =
  | "close-unpinned"
  | "close-including-pinned"
  | "cancel";

export type DomainCloseConfirmOption = {
  label: string;
  hotkey: string;
  action: DomainCloseConfirmAction;
  icon: string;
  count?: number;
};

const BASE_DOMAIN_CLOSE_CONFIRM_OPTIONS: readonly DomainCloseConfirmOption[] = [
  { label: "Close unpinned tabs", hotkey: "W", action: "close-unpinned", icon: "svg:x-circle" },
  { label: "Close all tabs", hotkey: "⇧W", action: "close-including-pinned", icon: "svg:pin" },
  { label: "Cancel", hotkey: "C", action: "cancel", icon: "svg:x-circle" },
];

export const DOMAIN_CLOSE_CONFIRM_OPTIONS = BASE_DOMAIN_CLOSE_CONFIRM_OPTIONS;

export function domainCloseConfirmOptionsForCounts(
  unpinnedCount = 0,
  pinnedCount = 0,
): readonly DomainCloseConfirmOption[] {
  const options: DomainCloseConfirmOption[] = [{
    ...BASE_DOMAIN_CLOSE_CONFIRM_OPTIONS[0],
    count: unpinnedCount,
  }];
  if (pinnedCount > 0) {
    options.push({
      ...BASE_DOMAIN_CLOSE_CONFIRM_OPTIONS[1],
      count: unpinnedCount + pinnedCount,
    });
  }
  options.push(BASE_DOMAIN_CLOSE_CONFIRM_OPTIONS[2]);
  return options;
}

export function domainCloseConfirmActionForHotkey(
  key: string,
  shiftKey = false,
  counts: { pinnedCount?: number } = {},
): DomainCloseConfirmAction | null {
  const upper = key.toUpperCase();
  if (upper === "W") {
    if (shiftKey && counts.pinnedCount === 0) return null;
    return shiftKey ? "close-including-pinned" : "close-unpinned";
  }
  if (upper === "C") return "cancel";
  return null;
}
