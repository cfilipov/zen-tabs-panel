import type { ViewActivation } from "./view-activation";
import type { DuplicatePromptAction } from "./duplicate-prompt-options";

export type ViewCommand =
  | { kind: "none" }
  | { kind: "message"; message: Record<string, unknown>; clearReveal?: boolean }
  | { kind: "open-domain"; domain: string }
  | { kind: "duplicate-prompt-action"; action: DuplicatePromptAction };

export function commandForViewActivation(activation: ViewActivation): ViewCommand {
  switch (activation.kind) {
    case "none":
      return { kind: "none" };
    case "activate-tab":
      return {
        kind: "message",
        clearReveal: true,
        message: { type: "activate-tab", domId: activation.row.domId },
      };
    case "activate-domain":
      return { kind: "open-domain", domain: activation.row.domain };
    case "navigate-history-index":
      return {
        kind: "message",
        clearReveal: true,
        message: { type: "navigate-to-history-index", index: activation.index },
      };
    case "restore-closed-tab":
      return {
        kind: "message",
        clearReveal: true,
        message: { type: "restore-closed-tab", sessionId: activation.row.sessionId },
      };
    case "move-to-workspace":
      return {
        kind: "message",
        clearReveal: true,
        message: {
          type: "move-selected-tabs-to-workspace",
          workspaceId: activation.row.uuid,
          ...(activation.switchToTarget ? { switchToTarget: true } : {}),
        },
      };
    case "reopen-in-container":
      return {
        kind: "message",
        clearReveal: true,
        message: { type: "reopen-in-container", userContextId: activation.row.userContextId },
      };
    case "move-to-folder":
      return {
        kind: "message",
        clearReveal: true,
        message: {
          type: "move-tab-to-folder",
          folderId: activation.row.id,
          ...(activation.switchToTarget ? { switchToTarget: true } : {}),
        },
      };
    case "launch-profile":
      if (activation.row.isCurrent) return { kind: "none" };
      return {
        kind: "message",
        clearReveal: true,
        message: { type: "launch-profile", name: activation.row.name },
      };
    case "duplicate-prompt-action":
      return { kind: "duplicate-prompt-action", action: activation.action };
  }
}
