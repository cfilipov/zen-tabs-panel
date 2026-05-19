type BrowserLike = {
  runtime: {
    sendMessage<T = unknown>(message: unknown): Promise<T>;
  };
};

declare const browser: BrowserLike | undefined;
declare const chrome: BrowserLike | undefined;

function getExt(): BrowserLike {
  if (typeof browser !== "undefined") return browser;
  if (typeof chrome !== "undefined") return chrome;
  throw new Error("WebExtension runtime is not available");
}

export function sendMessage<T = unknown>(message: unknown): Promise<T> {
  return getExt().runtime.sendMessage<T>(message);
}

export function fireMessage(message: unknown): void {
  getExt().runtime.sendMessage(message).catch(() => {});
}
