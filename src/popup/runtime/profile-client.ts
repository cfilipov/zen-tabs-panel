import { sendMessage } from "./ipc";

export type ProfileRow = {
  name: string;
  rootPath?: string;
  isCurrent: boolean;
  isDefault: boolean;
};

export type ProfilesViewModel = {
  version: number;
  view: "profiles";
  rows: ProfileRow[];
  selectedIndex: number;
  model: {
    id: "profiles";
    view: "profiles";
    rowIntents: Array<{
      rowId: string;
      index: number;
      chordKey: string | null;
      action: string;
      disabled?: boolean;
    }>;
  };
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

export function createProfileClient(send: Send = sendMessage) {
  return {
    getProfilesViewModel() {
      return send<ProfilesViewModel>({ type: "get-profiles-view-model" });
    },
  };
}
