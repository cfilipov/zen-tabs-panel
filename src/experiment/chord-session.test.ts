import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type ChordSessionScope = {
  createChordSession: (options: {
    replayActionId: string;
    replayRecordBlocklist?: string[];
    chordTree?: Record<string, unknown>;
    chordKeyFor?: (event: Record<string, unknown>) => string | null;
    constants?: Record<string, number>;
    setTimeoutFn?: (callback: () => void, ms: number) => number;
    clearTimeoutFn?: (id: number) => void;
    nowFn?: () => number;
    onOpenView?: (view: string | null, snapshot: string[], source: string) => void;
    onAction?: (payload: Record<string, unknown>) => void;
    onStateChange?: (path: string[]) => void;
    onBridgeKey?: (payload: Record<string, unknown>) => void;
    overlay?: Record<string, (...args: unknown[]) => unknown>;
  }) => ChordSession;
};

type ChordSession = {
  recordEvent: (event: Record<string, unknown>) => void;
  arm: () => void;
  acceptKey: (event: Record<string, unknown>) => void;
  resetCurrentReplay: () => void;
  replayLastChord: (effects: Record<string, unknown>) => boolean;
  hasCurrentReplay: () => boolean;
  hasCurrentOpenViewReplay: () => boolean;
  leaderArmElapsed: (now?: number) => number;
  shouldDebounceLeaderArm: (now?: number, threshold?: number) => boolean;
  markLeaderArm: (now?: number) => number;
  beginArm: (now?: number) => void;
  beginBridgeFromOpenView: (view?: string | null, kind?: string, source?: string) => Record<string, unknown>;
  finishBridge: (w?: { clearTimeout?: (id: number) => void } | null, why?: string) => void;
  markOverlayVisible: (why?: string) => void;
  markOverlayDestroying: (options?: { hard?: boolean; silent?: boolean }, why?: string) => string;
  markOverlayHidden: (why?: string) => void;
  markPopupReady: (why?: string, options?: { clearReadyTarget?: boolean }) => {
    wasBridging: boolean;
    drained: unknown[];
    readyView: string;
  };
  setPopupReady: (value: boolean, why?: string) => void;
  setReadyTargetView: (view: string | null, why?: string) => void;
  preparePopupLoad: (view?: string | null, why?: string) => void;
  setRevealDeferred: (value: boolean, why?: string) => void;
  clearRevealTimer: (w?: { clearTimeout?: (id: number) => void } | null, why?: string) => void;
  retargetActiveBridgeView: (view?: string | null, why?: string) => string;
  pushBridgeKey: (event: Record<string, unknown>) => number | null;
  transition: (to: string, why: string, data?: unknown) => void;
  observeLegacyState: (snapshot: unknown, why: string) => void;
  assertInvariant: (snapshot?: unknown) => true;
  getStateSnapshot: () => {
    state: string;
    revealBlocked?: boolean;
    revealDeferred?: boolean;
    activeBridgeView?: string | null;
    popupReady?: boolean;
    readyTargetView?: string | null;
    bridgeBufferLength?: number | null;
    bridgeTimerActive?: boolean;
    revealTimerActive?: boolean;
    lastLeaderArmAt: number;
    armSequence?: number;
    terminalDispatchArmSequence?: number;
    recentTransitions: Array<Record<string, unknown>>;
  };
  getReplayState: () => {
    lastChordReplay: unknown;
    currentChordReplay: unknown;
    preRecordedReplayKeys: unknown[];
  };
};

function loadSessionScope(): ChordSessionScope {
  const filename = path.resolve(process.cwd(), "src/experiment/chord-session.js");
  const code = fs.readFileSync(filename, "utf8");
  const context: Record<string, unknown> = { console };
  vm.runInNewContext(code, context, { filename });
  return context as ChordSessionScope;
}

function makeSession() {
  return loadSessionScope().createChordSession({
    replayActionId: "replay-last-chord",
    replayRecordBlocklist: ["duplicate-switch"],
  });
}

function makeInteractiveSession(overrides: Record<string, unknown> = {}) {
  let timer: (() => void) | null = null;
  let now = 0;
  const onOpenView = vi.fn();
  const onAction = vi.fn();
  const onStateChange = vi.fn();
  const onBridgeKey = vi.fn();
  const session = loadSessionScope().createChordSession({
    replayActionId: "replay-last-chord",
    replayRecordBlocklist: [],
    chordTree: {
      children: {
        R: { type: "open-view", view: "last-visited" },
        P: { type: "action", actionId: "go-to-previous-tab" },
        O: {
          type: "prefix",
          timeoutMs: 50,
          onTimeout: { type: "open-view", view: "reorder-tabs" },
          children: {
            D: { type: "action", actionId: "sort-tabs-domain-alpha" },
          },
        },
      },
    },
    chordKeyFor(event: Record<string, unknown>) {
      if (event.key === "Escape") return "Escape";
      if (typeof event.key === "string" && /^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
      return typeof event.key === "string" ? event.key : null;
    },
    constants: {
      CHORD_ROOT_TIMEOUT_MS: 50,
      CHORD_PREFIX_TIMEOUT_MS: 50,
    },
    setTimeoutFn(callback: () => void) {
      timer = callback;
      return 1;
    },
    clearTimeoutFn() {
      timer = null;
    },
    nowFn() {
      return now;
    },
    onOpenView,
    onAction,
    onStateChange,
    onBridgeKey,
    ...overrides,
  });
  return {
    session,
    onOpenView,
    onAction,
    onStateChange,
    onBridgeKey,
    setNow(value: number) { now = value; },
    fireTimer() {
      const callback = timer;
      timer = null;
      if (callback) callback();
    },
  };
}

describe("chord-session replay recording", () => {
  it("records terminal action chords as direct replay actions", () => {
    const session = makeSession();
    session.recordEvent({ kind: "terminal-action", payload: { type: "action", actionId: "go-to-previous-tab" } });

    expect(session.getReplayState()).toMatchObject({
      lastChordReplay: { kind: "action", actionId: "go-to-previous-tab" },
      currentChordReplay: null,
    });
  });

  it("does not record the replay action itself", () => {
    const session = makeSession();
    session.recordEvent({ kind: "terminal-action", payload: { type: "action", actionId: "replay-last-chord" } });

    expect(session.getReplayState().lastChordReplay).toBeNull();
  });

  it("records open-view chains only after a popup action commits them", () => {
    const session = makeSession();
    session.recordEvent({ kind: "open-view", view: "last-visited" });
    session.recordEvent({ kind: "bridge-key", keyData: { key: "2", code: "Digit2" } });

    expect(session.hasCurrentReplay()).toBe(true);
    expect(session.hasCurrentOpenViewReplay()).toBe(true);
    expect(session.getReplayState().lastChordReplay).toBeNull();

    session.recordEvent({ kind: "popup-action", message: { type: "activate-tab", tabId: 42 } });
    expect(session.getReplayState()).toMatchObject({
      lastChordReplay: { kind: "open-view", view: "last-visited", bridgeKeys: ["2"] },
      currentChordReplay: null,
    });
  });

  it("deduplicates popup echoes for pre-recorded bridge keys", () => {
    const session = makeSession();
    session.recordEvent({ kind: "open-view", view: "last-visited" });
    session.recordEvent({ kind: "bridge-key", keyData: { key: "3", code: "Digit3", __preRecorded: true } });
    session.recordEvent({ kind: "bridge-key", keyData: { key: "3", code: "Digit3" } });
    session.recordEvent({ kind: "popup-action", message: { type: "activate-tab", tabId: 42 } });

    expect(session.getReplayState().lastChordReplay).toMatchObject({
      kind: "open-view",
      bridgeKeys: ["3"],
    });
  });

  it("records shifted digit bridge keys in chord notation", () => {
    const session = makeSession();
    session.recordEvent({ kind: "open-view", view: "extension-popups" });
    session.recordEvent({ kind: "bridge-key", keyData: { key: "!", code: "Digit1", shiftKey: true } });
    session.recordEvent({ kind: "popup-action", message: { type: "open-extension-popup", extensionId: "abc" } });

    expect(session.getReplayState().lastChordReplay).toMatchObject({
      kind: "open-view",
      bridgeKeys: ["Shift+1"],
    });
  });

  it("falls back to raw popup action replay when no chord chain is active", () => {
    const session = makeSession();
    session.recordEvent({ kind: "popup-action", message: { type: "reload-tab", source: "click" } });

    expect(session.getReplayState().lastChordReplay).toMatchObject({
      kind: "action-msg",
      type: "reload-tab",
      source: "click",
    });
  });

  it("ignores blocklisted popup actions", () => {
    const session = makeSession();
    session.recordEvent({ kind: "popup-action", message: { type: "duplicate-switch" } });

    expect(session.getReplayState().lastChordReplay).toBeNull();
  });

  it("replays open-view chains by re-entering bridge and forwarding keys", () => {
    const session = makeSession();
    const enterBridgeFromOpenView = vi.fn();
    const forwardKeyToPopup = vi.fn();
    const debug = vi.fn();

    session.recordEvent({ kind: "open-view", view: "last-visited" });
    session.recordEvent({ kind: "bridge-key", keyData: { key: "2", code: "Digit2" } });
    session.recordEvent({ kind: "popup-action", message: { type: "activate-tab", tabId: 42 } });

    expect(session.replayLastChord({ enterBridgeFromOpenView, forwardKeyToPopup, debug })).toBe(true);
    expect(enterBridgeFromOpenView).toHaveBeenCalledWith("last-visited", "chrome", "match");
    expect(forwardKeyToPopup).toHaveBeenCalledWith({
      key: "2",
      code: "Digit2",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    expect(debug).toHaveBeenCalledWith("replay-open-view", { view: "last-visited", keys: ["2"] });
  });

  it("replays shifted row keys as real shifted digit events", () => {
    const session = makeSession();
    const enterBridgeFromOpenView = vi.fn();
    const forwardKeyToPopup = vi.fn();

    session.recordEvent({ kind: "open-view", view: "move-to-workspace" });
    session.recordEvent({ kind: "bridge-key", keyData: { key: "!", code: "Digit1", shiftKey: true } });
    session.recordEvent({ kind: "popup-action", message: { type: "move-selected-tabs-to-workspace", workspaceId: "ws-2", switchToTarget: true } });

    expect(session.replayLastChord({ enterBridgeFromOpenView, forwardKeyToPopup })).toBe(true);
    expect(forwardKeyToPopup).toHaveBeenCalledWith({
      key: "Shift+1",
      code: "Digit1",
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });
  });

  it("replays direct actions through the supplied dispatcher", () => {
    const session = makeSession();
    const dispatchReplayedAction = vi.fn(() => true);
    session.recordEvent({ kind: "terminal-action", payload: { type: "action", actionId: "close-tab" } });

    expect(session.replayLastChord({ dispatchReplayedAction })).toBe(true);
    expect(dispatchReplayedAction).toHaveBeenCalledWith("close-tab");
  });

  it("resets only the current in-flight trace on arm", () => {
    const session = makeSession();
    session.recordEvent({ kind: "terminal-action", payload: { type: "action", actionId: "close-tab" } });
    session.recordEvent({ kind: "open-view", view: "last-visited" });
    session.recordEvent({ kind: "armed" });

    expect(session.getReplayState()).toMatchObject({
      lastChordReplay: { kind: "action", actionId: "close-tab" },
      currentChordReplay: null,
    });
  });

  it("owns leader debounce timing", () => {
    const session = makeSession();

    expect(session.leaderArmElapsed(100)).toBe(100);
    expect(session.shouldDebounceLeaderArm(100, 80)).toBe(false);

    session.beginArm(100);
    expect(session.getStateSnapshot().lastLeaderArmAt).toBe(100);
    expect(session.leaderArmElapsed(140)).toBe(40);
    expect(session.shouldDebounceLeaderArm(140, 80)).toBe(true);
    expect(session.shouldDebounceLeaderArm(190, 80)).toBe(false);

    session.markLeaderArm(220);
    expect(session.getStateSnapshot().lastLeaderArmAt).toBe(220);
  });

  it("records state transitions for inspector diagnostics", () => {
    const session = makeSession();
    session.recordEvent({ kind: "armed" });
    session.recordEvent({ kind: "open-view", view: "last-visited" });
    session.transition("bridging-live", "test-ready");
    session.transition("visible", "test-visible");

    expect(session.getStateSnapshot()).toMatchObject({
      state: "visible",
      recentTransitions: [
        { from: "idle", to: "armed-root", why: "armed" },
        { from: "armed-root", to: "bridging-buffering", why: "open-view" },
        { from: "bridging-buffering", to: "bridging-live", why: "test-ready" },
        { from: "bridging-live", to: "visible", why: "test-visible" },
      ],
    });
  });

  it("rejects unknown state transitions", () => {
    const session = makeSession();

    expect(() => session.transition("spooky-state", "unit-test")).toThrow("[ChordSession] unknown state");
    expect(session.getStateSnapshot().state).toBe("idle");
  });

  it("records cancel as a first-class terminal state", () => {
    const env = makeInteractiveSession();
    env.session.arm();
    env.session.acceptKey({ kind: "key", key: "Escape", code: "Escape", shimTs: 10 });

    expect(env.session.getStateSnapshot().state).toBe("idle");
    expect(env.session.getStateSnapshot().recentTransitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "armed-root", to: "cancelled", why: "cancel" }),
      expect.objectContaining({ from: "cancelled", to: "idle", why: "cancel-idle" }),
    ]));
  });

  it("names overlay lifecycle transitions", () => {
    const session = makeSession();

    session.markOverlayVisible("revealOverlay");
    expect(session.getStateSnapshot().state).toBe("visible");

    expect(session.markOverlayDestroying({ hard: false, silent: false }, "destroyOverlay")).toBe("destroying");
    expect(session.getStateSnapshot().state).toBe("destroying");

    session.markOverlayHidden("destroyOverlay-finish");
    expect(session.getStateSnapshot().state).toBe("idle");
  });

  it("keeps silent overlay destroy in bridge state when a bridge is active", () => {
    const session = makeSession();

    session.beginBridgeFromOpenView("last-visited", "chrome", "match");
    expect(session.markOverlayDestroying({ silent: true }, "destroyOverlay-silent")).toBe("bridging-buffering");
    expect(session.getStateSnapshot().state).toBe("bridging-buffering");
    expect(session.getStateSnapshot().activeBridgeView).toBe("last-visited");
  });

  it("throws when legacy state disagrees", () => {
    const session = makeSession();
    session.recordEvent({ kind: "armed" });

    expect(() => session.observeLegacyState({
      bridge: { active: true, popupReady: false },
      overlay: { visibility: "hidden" },
      traversal: { armed: true, path: [] },
    }, "unit-test")).toThrow("[ChordSession] state mismatch");
  });

  it("treats opacity-hidden pending reveal overlays as bridging-live", () => {
    const session = makeSession();
    session.recordEvent({ kind: "armed" });
    session.recordEvent({ kind: "open-view", view: null });
    session.transition("bridging-live", "unit-ready");

    expect(() => session.observeLegacyState({
      bridge: { active: true, popupReady: true },
      overlay: { visibility: "visible", pendingReveal: true },
      traversal: { armed: true, path: [] },
    }, "unit-test")).not.toThrow();
  });

  it("asserts impossible transition patterns", () => {
    const session = makeSession();
    session.transition("bridging-buffering", "test-buffer");
    session.transition("visible", "test-visible");

    expect(() => session.assertInvariant()).toThrow("[ChordSession] invalid transition");
  });

  it("processes content keys typed before root timeout as chord matches", () => {
    const env = makeInteractiveSession();
    env.session.arm();

    env.setNow(100);
    env.fireTimer();
    expect(env.onOpenView).toHaveBeenCalledWith(null, [], "timeout");

    env.session.acceptKey({ kind: "key", key: "r", code: "KeyR", shimTs: 90 });

    expect(env.onBridgeKey).not.toHaveBeenCalled();
    expect(env.onOpenView).toHaveBeenLastCalledWith("last-visited", ["R"], "late-match");
    expect(env.session.getStateSnapshot().recentTransitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "bridging-buffering", to: "armed-root", why: "late-timeout-restore" }),
    ]));
  });

  it("keeps keys typed after root timeout on the bridge path", () => {
    const env = makeInteractiveSession();
    env.session.arm();

    env.setNow(100);
    env.fireTimer();
    env.session.acceptKey({ kind: "key", key: "r", code: "KeyR", shimTs: 110 });

    expect(env.onOpenView).toHaveBeenCalledTimes(1);
    expect(env.onBridgeKey).toHaveBeenCalledWith(expect.objectContaining({
      key: "r",
      code: "KeyR",
      shimTs: 110,
    }));
  });

  it("records typed open-view matches at the acceptKey boundary", () => {
    const env = makeInteractiveSession();
    env.session.arm();

    env.session.acceptKey({ kind: "key", key: "r", code: "KeyR", shimTs: 10 });

    expect(env.session.getReplayState().currentChordReplay).toMatchObject({
      kind: "open-view",
      view: "last-visited",
      bridgeKeys: [],
    });
  });

  it("opens a prefix view when the prefix key beat the root timeout", () => {
    const env = makeInteractiveSession();
    env.session.arm();

    env.setNow(100);
    env.fireTimer();
    env.session.acceptKey({ kind: "key", key: "o", code: "KeyO", shimTs: 90 });

    expect(env.onBridgeKey).not.toHaveBeenCalled();
    expect(env.onStateChange).toHaveBeenCalledWith(["O"]);
    expect(env.onOpenView).toHaveBeenLastCalledWith("reorder-tabs", ["O"], "late-match");
  });

  it("fires a prefix child action when the child key beat the prefix timeout", () => {
    const env = makeInteractiveSession();
    env.session.arm();
    env.session.acceptKey({ kind: "key", key: "o", code: "KeyO", shimTs: 10 });

    env.setNow(100);
    env.fireTimer();
    env.session.acceptKey({ kind: "key", key: "d", code: "KeyD", shimTs: 90 });

    expect(env.onBridgeKey).not.toHaveBeenCalled();
    expect(env.onAction).toHaveBeenCalledWith({
      type: "action",
      actionId: "sort-tabs-domain-alpha",
    });
  });

  it("uses the overlay controller for arm, prefix prerender, and cancel cleanup", () => {
    const overlay = {
      create: vi.fn(),
      destroy: vi.fn(),
      hasPendingReveal: vi.fn(() => true),
    };
    const env = makeInteractiveSession({ overlay });

    env.session.arm();
    expect(overlay.create).toHaveBeenCalledWith();

    env.session.acceptKey({ kind: "key", key: "o", code: "KeyO", shimTs: 10 });
    expect(overlay.destroy).toHaveBeenCalledWith({ silent: true });
    expect(overlay.create).toHaveBeenLastCalledWith("reorder-tabs");

    env.session.acceptKey({ kind: "key", key: "Escape", code: "Escape", shimTs: 20 });
    expect(overlay.destroy).toHaveBeenLastCalledWith();
  });

  it("owns bridge entry and late retarget bookkeeping", () => {
    const session = makeSession();

    expect(session.beginBridgeFromOpenView("last-visited", "chrome", "match")).toMatchObject({
      mode: "new-bridge",
      requestedView: "last-visited",
      activeView: "last-visited",
    });
    expect(session.getStateSnapshot()).toMatchObject({
      state: "bridging-buffering",
      activeBridgeView: "last-visited",
      popupReady: false,
      bridgeBufferLength: 0,
    });

    expect(session.beginBridgeFromOpenView("tabs-by-age", "chrome", "match")).toMatchObject({
      mode: "ignored-active-bridge",
    });
    expect(session.getStateSnapshot().activeBridgeView).toBe("last-visited");

    expect(session.beginBridgeFromOpenView("tabs-by-age", "chrome", "late-match")).toMatchObject({
      mode: "retarget-active-bridge",
      activeView: "tabs-by-age",
    });
    expect(session.getStateSnapshot().activeBridgeView).toBe("tabs-by-age");
  });

  it("owns bridge finish bookkeeping", () => {
    const session = makeSession();

    session.beginBridgeFromOpenView("last-visited", "chrome", "match");
    session.pushBridgeKey({ key: "1" });
    session.setPopupReady(true, "popup-ready");
    session.setRevealDeferred(true, "reveal-deferred");

    session.finishBridge(null, "finishBridge");

    expect(session.getStateSnapshot()).toMatchObject({
      state: "idle",
      activeBridgeView: null,
      popupReady: false,
      revealDeferred: false,
      bridgeBufferLength: null,
    });
  });

  it("drains buffered keys and marks popup ready in one bridge transition", () => {
    const session = makeSession();

    session.beginBridgeFromOpenView("last-visited", "chrome", "match");
    session.pushBridgeKey({ key: "2" });
    session.setReadyTargetView("last-visited", "ready-target-view");

    const ready = session.markPopupReady("takeChordBridgeBuffer", { clearReadyTarget: true });

    expect(ready).toMatchObject({
      wasBridging: true,
      drained: [{ key: "2" }],
      readyView: "last-visited",
    });
    expect(session.getStateSnapshot()).toMatchObject({
      state: "bridging-live",
      popupReady: true,
      readyTargetView: null,
      bridgeBufferLength: 0,
    });
  });

  it("prepares popup load readiness and target view together", () => {
    const session = makeSession();

    session.setPopupReady(true, "popup-ready");
    session.preparePopupLoad("last-visited", "createOverlay");

    expect(session.getStateSnapshot()).toMatchObject({
      popupReady: false,
      readyTargetView: "last-visited",
    });
  });

  it("retargets the active bridge view with a named session operation", () => {
    const session = makeSession();

    session.beginBridgeFromOpenView("last-visited", "chrome", "match");
    expect(session.retargetActiveBridgeView("domain-tabs", "switchHiddenBridgeView")).toBe("domain-tabs");

    expect(session.getStateSnapshot().activeBridgeView).toBe("domain-tabs");
  });

  it("clears deferred reveal state when clearing the reveal timer", () => {
    const session = makeSession();

    session.setRevealDeferred(true, "reveal-deferred");
    session.clearRevealTimer(null, "reveal-deferred-clear");

    expect(session.getStateSnapshot().revealDeferred).toBe(false);
  });

  it("commits chrome model row intents instead of popup bridge replays", () => {
    const session = makeSession();
    session.recordEvent({ kind: "open-view", view: "last-visited" });
    session.recordEvent({ kind: "bridge-key", keyData: { key: "2", code: "Digit2", __preRecorded: true } });
    session.recordEvent({
      kind: "model-row-intent",
      view: "last-visited",
      chordKey: "2",
      switchToTarget: false,
      params: { workspaceId: "all" },
    });
    session.recordEvent({ kind: "popup-action", message: { type: "activate-tab", tabId: 42 } });

    expect(session.getReplayState().lastChordReplay).toMatchObject({
      kind: "model-row-intent",
      view: "last-visited",
      chordKey: "2",
      switchToTarget: false,
      params: { workspaceId: "all" },
    });
  });

  it("replays chrome model row intents without forwarding keys to the popup", () => {
    const session = makeSession();
    const dispatchModelRowIntent = vi.fn(() => true);
    const forwardKeyToPopup = vi.fn();

    session.recordEvent({
      kind: "model-row-intent",
      view: "move-to-workspace",
      chordKey: "Shift+1",
      switchToTarget: true,
    });
    session.recordEvent({ kind: "popup-action", message: { type: "move-selected-tabs-to-workspace", workspaceId: "ws-2", switchToTarget: true } });

    expect(session.replayLastChord({ dispatchModelRowIntent, forwardKeyToPopup })).toBe(true);
    expect(dispatchModelRowIntent).toHaveBeenCalledWith("move-to-workspace", "Shift+1", true, null);
    expect(forwardKeyToPopup).not.toHaveBeenCalled();
  });
});
