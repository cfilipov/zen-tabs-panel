import { sendMessage } from "./ipc";

export type WorkspaceRow = {
  uuid: string;
  name: string;
  svgContent: string;
  lucideIconName?: string | null;
  zenIconName?: string | null;
  emojiIcon?: string | null;
  isActive: boolean;
  tabCount?: number;
  chordKey?: string | null;
};

export type ZenWorkspaceIconRow = {
  name: string;
  label: string;
  svgContent: string;
};

export type ActiveWorkspaceName = {
  name: string;
};

export type WorkspacesViewModel = {
  version: number;
  view: "move-to-workspace";
  rows: WorkspaceRow[];
  selectedIndex: number;
  model: {
    id: "workspaces";
    view: "move-to-workspace";
    rowIntents: Array<{
      rowId: string;
      index: number;
      chordKey: string | null;
      shiftedChordKey: string | null;
      action: string;
      disabled?: boolean;
    }>;
  };
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

export function createWorkspaceClient(send: Send = sendMessage) {
  return {
    getWorkspacesWithIcons() {
      return send<WorkspaceRow[]>({ type: "get-workspaces-with-icons" });
    },
    getWorkspacesViewModel() {
      return send<WorkspacesViewModel>({ type: "get-workspaces-view-model" });
    },
    getZenWorkspaceIcons() {
      return send<ZenWorkspaceIconRow[]>({ type: "get-zen-workspace-icons" });
    },
    setActiveWorkspaceIcon(kind: "emoji" | "zen" | "lucide", value: string) {
      return send<{ success: boolean; error?: string }>({ type: "set-active-workspace-icon", kind, value });
    },
    getActiveWorkspaceName() {
      return send<ActiveWorkspaceName>({ type: "get-active-workspace-name" });
    },
    setActiveWorkspaceName(name: string) {
      return send<boolean>({ type: "set-active-workspace-name", name });
    },
  };
}
