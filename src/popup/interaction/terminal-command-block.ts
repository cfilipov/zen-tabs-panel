export type TerminalCommandBlocker = {
  markDispatched: () => void;
  clear: () => void;
  isBlocking: () => boolean;
};

export function createTerminalCommandBlocker(options: {
  now?: () => number;
  blockMs?: number;
} = {}): TerminalCommandBlocker {
  const now = options.now ?? Date.now;
  const blockMs = options.blockMs ?? 500;
  let dispatched = false;
  let dispatchedAt = 0;

  function clear() {
    dispatched = false;
    dispatchedAt = 0;
  }

  function markDispatched() {
    dispatched = true;
    dispatchedAt = now();
  }

  function isBlocking() {
    if (!dispatched) return false;
    if (now() - dispatchedAt < blockMs) return true;
    clear();
    return false;
  }

  return {
    markDispatched,
    clear,
    isBlocking,
  };
}
