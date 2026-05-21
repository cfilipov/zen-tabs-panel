import { sendMessage } from "./ipc";

export type FolderRow = {
  id: string;
  name: string;
  workspaceId: string | null;
};

export type FoldersViewModel = {
  version: number;
  view: "move-to-folder";
  rows: FolderRow[];
  selectedIndex: number;
  model: {
    id: "folders";
    view: "move-to-folder";
    rowIntents: Array<{
      rowId: string;
      index: number;
      chordKey: string | null;
      shiftedChordKey: string | null;
      action: string;
    }>;
  };
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

export function createFolderClient(send: Send = sendMessage) {
  return {
    getFolders() {
      return send<FolderRow[]>({ type: "get-folders" });
    },
    getFoldersViewModel() {
      return send<FoldersViewModel>({ type: "get-folders-view-model" });
    },
  };
}
