import type { BridgeKeyData, BridgeReply, ForceReadyPayload } from "../chord-bridge";

type MaybePromise<T> = T | Promise<T>;

export type BridgeDispatchController = {
  readonly ready: boolean;
  readonly warmGeneration: number;
  queueOrHold: (input: BridgeKeyData) => void;
  keydownInput: (input: BridgeKeyData) => { preventDefault: true; stopPropagation: boolean };
  resetForWarmRearm: () => number;
  isCurrentWarmGeneration: (generation: number) => boolean;
  drainReply: (reply: BridgeReply | null, generation?: number) => Promise<void>;
  forceReady: (data: ForceReadyPayload) => void;
};

type BridgeDispatchOptions = {
  dispatchKey: (input: BridgeKeyData) => MaybePromise<void>;
  armRevealTimer: () => void;
  clearRevealTimer: () => void;
};

function replyBuffered(reply: BridgeReply | null) {
  return Array.isArray(reply?.buffered) ? reply.buffered : [];
}

function forceBuffered(data: ForceReadyPayload) {
  return Array.isArray(data.buffered) ? data.buffered : [];
}

export function createBridgeDispatchController(options: BridgeDispatchOptions): BridgeDispatchController {
  let ready = false;
  let dispatchRunning = false;
  let warmGeneration = 0;
  const heldLiveKeys: BridgeKeyData[] = [];
  const liveDispatchQueue: BridgeKeyData[] = [];

  const isCurrentWarmGeneration = (generation: number) => generation === warmGeneration;

  async function runLiveDispatchQueue() {
    if (dispatchRunning) return;
    dispatchRunning = true;
    try {
      while (liveDispatchQueue.length > 0) {
        const input = liveDispatchQueue.shift();
        if (!input) continue;
        options.armRevealTimer();
        await options.dispatchKey(input);
      }
    } finally {
      dispatchRunning = false;
    }
  }

  function enqueue(input: BridgeKeyData) {
    liveDispatchQueue.push(input);
    void runLiveDispatchQueue();
  }

  function queueOrHold(input: BridgeKeyData) {
    if (!ready) {
      heldLiveKeys.push(input);
      return;
    }
    enqueue(input);
  }

  async function dispatchDrained(inputs: BridgeKeyData[], generation?: number) {
    for (const input of inputs) {
      if (generation !== undefined && !isCurrentWarmGeneration(generation)) return false;
      options.armRevealTimer();
      await options.dispatchKey(input);
    }
    return true;
  }

  return {
    get ready() {
      return ready;
    },
    get warmGeneration() {
      return warmGeneration;
    },
    queueOrHold,
    keydownInput(input) {
      queueOrHold(input);
      return { preventDefault: true, stopPropagation: !ready };
    },
    resetForWarmRearm() {
      warmGeneration += 1;
      ready = false;
      liveDispatchQueue.length = 0;
      heldLiveKeys.length = 0;
      options.clearRevealTimer();
      return warmGeneration;
    },
    isCurrentWarmGeneration,
    async drainReply(reply, generation) {
      if (reply?.stale) return;
      const buffered = replyBuffered(reply);
      const held = heldLiveKeys.splice(0);
      if (!(await dispatchDrained(buffered, generation))) return;
      if (!(await dispatchDrained(held, generation))) return;
      if (generation !== undefined && !isCurrentWarmGeneration(generation)) return;
      ready = true;
      if (buffered.length === 0 && held.length === 0) {
        options.armRevealTimer();
      }
    },
    forceReady(data) {
      const buffered = forceBuffered(data);
      const held = heldLiveKeys.splice(0);
      ready = true;
      options.clearRevealTimer();
      for (const input of buffered) enqueue(input);
      for (const input of held) enqueue(input);
    },
  };
}
