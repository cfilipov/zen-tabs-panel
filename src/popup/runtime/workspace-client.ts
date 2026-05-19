import { sendMessage } from "./ipc";

export type WorkspaceRow = {
  uuid: string;
  name: string;
  svgContent: string;
  isActive: boolean;
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

export function createWorkspaceClient(send: Send = sendMessage) {
  return {
    getWorkspacesWithIcons() {
      return send<WorkspaceRow[]>({ type: "get-workspaces-with-icons" });
    },
  };
}
