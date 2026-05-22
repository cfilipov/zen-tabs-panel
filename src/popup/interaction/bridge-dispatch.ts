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

type DispatchState =
  | { mode: "holding"; held: BridgeKeyData[] }
  | { mode: "live" };

function replyBuffered(reply: BridgeReply | null) {
  return Array.isArray(reply?.buffered) ? reply.buffered : [];
}

function forceBuffered(data: ForceReadyPayload) {
  return Array.isArray(data.buffered) ? data.buffered : [];
}

export function createBridgeDispatchController(options: BridgeDispatchOptions): BridgeDispatchController {
  let state: DispatchState = { mode: "holding", held: [] };
  let dispatchRunning = false;
  let generation = 0;
  const liveDispatchQueue: QueuedInput[] = [];

  const isCurrentWarmGeneration = (value: number) => value === generation;

  function isLive() {
    return state.mode === "live";
  }

  function heldKeys() {
    if (state.mode !== "holding") return [];
    const held = state.held;
    state = { mode: "live" };
    return held;
  }

  async function runLiveDispatchQueue() {
    if (dispatchRunning) return;
    dispatchRunning = true;
    const runGeneration = generation;
    try {
      while (runGeneration === generation && liveDispatchQueue.length > 0) {
        const queued = liveDispatchQueue.shift();
        if (!queued) continue;
        await options.dispatchKey(queued.input);
        if (runGeneration !== generation) return;
        if (liveDispatchQueue.length === 0) {
          if (queued.origin === "visible") options.armVisibleRevealTimer();
          else options.armBridgeRevealTimer();
        }
      }
    } finally {
      if (runGeneration === generation) {
        dispatchRunning = false;
      }
    }
  }

  function enqueue(input: BridgeKeyData, origin: QueuedInput["origin"]) {
    liveDispatchQueue.push({ input, origin });
    void runLiveDispatchQueue();
  }

  function cancelLiveDispatch() {
    generation += 1;
    dispatchRunning = false;
    liveDispatchQueue.length = 0;
  }

  function queueOrHold(input: BridgeKeyData) {
    if (state.mode === "holding") {
      state.held.push(input);
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
      return isLive();
    },
    get warmGeneration() {
      return generation;
    },
    queueOrHold,
    keydownInput(input) {
      queueOrHold(input);
      return { preventDefault: true, stopPropagation: !isLive() };
    },
    visibleKeydownInput(input) {
      state = { mode: "live" };
      options.clearRevealTimer();
      enqueue(input, "visible");
      return { preventDefault: true, stopPropagation: true };
    },
    resetForWarmRearm() {
      cancelLiveDispatch();
      state = { mode: "holding", held: [] };
      options.clearRevealTimer();
      return generation;
    },
    isCurrentWarmGeneration,
    async drainReply(reply, generation) {
      if (reply?.stale) return;
      const buffered = replyBuffered(reply);
      const held = heldKeys();
      const drained = buffered.concat(held);
      if (!(await dispatchDrained(drained, generation))) return;
      if (generation !== undefined && !isCurrentWarmGeneration(generation)) return;
      state = { mode: "live" };
      if (drained.length === 0 && reply?.armRevealTimer) options.armBridgeRevealTimer();
    },
    forceReady(data) {
      const buffered = forceBuffered(data);
      const held = heldKeys();
      state = { mode: "live" };
      options.clearRevealTimer();
      liveDispatchQueue.unshift(
        ...buffered.concat(held).map((input) => ({ input, origin: "bridge" as const }))
      );
      void runLiveDispatchQueue();
    },
  };
}
