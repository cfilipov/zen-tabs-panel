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
  armBridgeRevealTimer: () => void;
  armVisibleRevealTimer: () => void;
  clearRevealTimer: () => void;
};

type QueuedInput = {
  input: BridgeKeyData;
  origin: "bridge" | "visible";
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
  let liveDispatchGeneration = 0;
  let warmGeneration = 0;
  const heldLiveKeys: BridgeKeyData[] = [];
  const liveDispatchQueue: QueuedInput[] = [];

  const isCurrentWarmGeneration = (generation: number) => generation === warmGeneration;

  async function runLiveDispatchQueue() {
    if (dispatchRunning) return;
    dispatchRunning = true;
    const generation = liveDispatchGeneration;
    try {
      while (generation === liveDispatchGeneration && liveDispatchQueue.length > 0) {
        const queued = liveDispatchQueue.shift();
        if (!queued) continue;
        await options.dispatchKey(queued.input);
        if (generation !== liveDispatchGeneration) return;
        if (liveDispatchQueue.length === 0) {
          if (queued.origin === "visible") options.armVisibleRevealTimer();
          else options.armBridgeRevealTimer();
        }
      }
    } finally {
      if (generation === liveDispatchGeneration) {
        dispatchRunning = false;
      }
    }
  }

  function enqueue(input: BridgeKeyData, origin: QueuedInput["origin"]) {
    liveDispatchQueue.push({ input, origin });
    void runLiveDispatchQueue();
  }

  function cancelLiveDispatch() {
    liveDispatchGeneration += 1;
    dispatchRunning = false;
    liveDispatchQueue.length = 0;
  }

  function queueOrHold(input: BridgeKeyData) {
    if (!ready) {
      heldLiveKeys.push(input);
      return;
    }
    options.clearRevealTimer();
    enqueue(input, "bridge");
  }

  async function dispatchDrained(inputs: BridgeKeyData[], generation?: number) {
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const isLastPendingInput = index === inputs.length - 1;
      if (generation !== undefined && !isCurrentWarmGeneration(generation)) return false;
      await options.dispatchKey(input);
      if (generation !== undefined && !isCurrentWarmGeneration(generation)) return false;
      if (isLastPendingInput) options.armBridgeRevealTimer();
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
      enqueue(input, "visible");
      return { preventDefault: true, stopPropagation: true };
    },
    resetForWarmRearm() {
      warmGeneration += 1;
      ready = false;
      cancelLiveDispatch();
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
      void reply;
    },
    forceReady(data) {
      const buffered = forceBuffered(data);
      const held = heldLiveKeys.splice(0);
      ready = true;
      options.clearRevealTimer();
      liveDispatchQueue.unshift(
        ...buffered.concat(held).map((input) => ({ input, origin: "bridge" as const }))
      );
      void runLiveDispatchQueue();
    },
  };
}
