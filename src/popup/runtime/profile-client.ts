import { sendMessage } from "./ipc";

export type ProfileRow = {
  name: string;
  rootPath?: string;
  isCurrent: boolean;
  isDefault: boolean;
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

export function createProfileClient(send: Send = sendMessage) {
  return {
    getProfiles() {
      return send<ProfileRow[]>({ type: "get-profiles" });
    },
  };
}
