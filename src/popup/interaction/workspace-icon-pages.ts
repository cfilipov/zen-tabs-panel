export type WorkspaceIconKind = "emoji" | "zen" | "lucide";

export const WORKSPACE_ICON_PAGES: Array<{ kind: WorkspaceIconKind; label: string; shortcut: string }> = [
  { kind: "emoji", label: "Emoji", shortcut: "⌃1" },
  { kind: "zen", label: "Zen", shortcut: "⌃2" },
  { kind: "lucide", label: "Lucide", shortcut: "⌃3" },
];
