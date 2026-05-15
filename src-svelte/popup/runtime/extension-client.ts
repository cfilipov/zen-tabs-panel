import { sendMessage } from "./ipc";

export type ExtensionRow = {
  id: string;
  name: string;
  popupUrl: string;
  iconDataUrl: string;
};

export type Send = <T = unknown>(message: unknown) => Promise<T>;

export function createExtensionClient(send: Send = sendMessage) {
  return {
    listExtensions() {
      return send<ExtensionRow[]>({ type: "list-extensions" });
    },
  };
}
