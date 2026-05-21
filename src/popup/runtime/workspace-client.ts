import { sendMessage } from "./ipc";

export type WorkspaceRow = {
  uuid: string;
  name: string;
  svgContent: string;
  isActive: boolean;
  tabCount?: number;
  chordKey?: string | null;
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
  };
}
