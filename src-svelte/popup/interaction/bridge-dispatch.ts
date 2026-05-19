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
  visibleKeydownInput: (input: BridgeKeyData) => { preventDefault: true; stopPropagation: true };
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
        await options.dispatchKey(input);
        if (liveDispatchQueue.length === 0) options.armRevealTimer();
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
    options.clearRevealTimer();
    enqueue(input);
  }

  async function dispatchDrained(inputs: BridgeKeyData[], generation?: number) {
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const isLastPendingInput = index === inputs.length - 1;
      if (generation !== undefined && !isCurrentWarmGeneration(generation)) return false;
      await options.dispatchKey(input);
      if (generation !== undefined && !isCurrentWarmGeneration(generation)) return false;
      if (isLastPendingInput) options.armRevealTimer();
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
    visibleKeydownInput(input) {
      ready = true;
      options.clearRevealTimer();
      enqueue(input);
      return { preventDefault: true, stopPropagation: true };
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
      const drained = buffered.concat(held);
      if (!(await dispatchDrained(drained, generation))) return;
      if (generation !== undefined && !isCurrentWarmGeneration(generation)) return;
      ready = true;
      if (drained.length === 0 && reply?.armRevealTimer !== false) {
        options.armRevealTimer();
      }
    },
    forceReady(data) {
      const buffered = forceBuffered(data);
      const held = heldLiveKeys.splice(0);
      ready = true;
      options.clearRevealTimer();
      liveDispatchQueue.push(...buffered, ...held);
      void runLiveDispatchQueue();
    },
  };
}
