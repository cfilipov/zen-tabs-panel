import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type ChordSessionScope = {
  createChordSession: (options: {
    replayActionId: string;
    replayRecordBlocklist?: string[];
  }) => ChordSession;
};

type ChordSession = {
  recordEvent: (event: Record<string, unknown>) => void;
  resetCurrentReplay: () => void;
  replayLastChord: (effects: Record<string, unknown>) => boolean;
  hasCurrentReplay: () => boolean;
  hasCurrentOpenViewReplay: () => boolean;
  transition: (to: string, why: string, data?: unknown) => void;
  observeLegacyState: (snapshot: unknown, why: string) => void;
  assertInvariant: (snapshot?: unknown) => true;
  getStateSnapshot: () => {
    state: string;
    recentTransitions: Array<Record<string, unknown>>;
  };
  getReplayState: () => {
    lastChordReplay: unknown;
    currentChordReplay: unknown;
    preRecordedReplayKeys: unknown[];
    syntheticReplayEvents: unknown[];
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

  it("records synthetic chord events without firing or committing actions", () => {
    const session = makeSession();
    session.recordEvent({ kind: "synthetic-key", chordKey: "3", view: "last-visited", activation: "trace" });

    expect(session.getReplayState()).toMatchObject({
      lastChordReplay: null,
      currentChordReplay: null,
      syntheticReplayEvents: [
        expect.objectContaining({ chordKey: "3", view: "last-visited", activation: "trace" }),
      ],
    });
  });

  it("uses synthetic chord events as replay bridge keys", () => {
    const session = makeSession();
    session.recordEvent({ kind: "open-view", view: "last-visited" });
    session.recordEvent({ kind: "synthetic-key", chordKey: "3", view: "last-visited", activation: "trace" });
    session.recordEvent({ kind: "popup-action", message: { type: "activate-tab", tabId: 42 } });

    expect(session.getReplayState().lastChordReplay).toMatchObject({
      kind: "open-view",
      view: "last-visited",
      bridgeKeys: ["3"],
    });
  });
});
