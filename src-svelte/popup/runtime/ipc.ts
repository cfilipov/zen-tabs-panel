type BrowserLike = {
  runtime: {
    sendMessage<T = unknown>(message: unknown): Promise<T>;
  };
};

declare const browser: BrowserLike | undefined;
declare const chrome: BrowserLike | undefined;

export const ext: BrowserLike = (typeof browser !== "undefined" ? browser : chrome) as BrowserLike;

export function sendMessage<T = unknown>(message: unknown): Promise<T> {
  return ext.runtime.sendMessage<T>(message);
}

export function fireMessage(message: unknown): void {
  ext.runtime.sendMessage(message).catch(() => {});
}
