import { sendMessage } from "./ipc";

export type FolderRow = {
  id: string;
  name: string;
  workspaceId: string | null;
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

export function createFolderClient(send: Send = sendMessage) {
  return {
    getFolders() {
      return send<FolderRow[]>({ type: "get-folders" });
    },
  };
}
