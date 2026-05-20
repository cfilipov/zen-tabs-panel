"use strict";

// ChordSession is the chrome-side owner for chord progression, bridge state
// diagnostics, and replay recording. It may host the single chrome chord-tree
// traverser internally; per-process shims only capture and forward keys.
(function (scope) {
  function clonePlain(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (e) { return String(value); }
  }

  function replayKeyFromBridgeKey(keyData) {
    if (!keyData || typeof keyData.key !== "string" || !keyData.key) return null;
    if (keyData.key.length === 1 && /[a-z]/i.test(keyData.key)) {
      return (keyData.shiftKey ? "Shift+" : "") + keyData.key.toUpperCase();
    }
    if (keyData.shiftKey && keyData.code && /^Digit[1-9]$/.test(keyData.code)) {
      return "Shift+" + keyData.code.slice("Digit".length);
    }
    return keyData.key;
  }

  function createChordSession(options) {
    const replayActionId = options && options.replayActionId;
    const replayRecordBlocklist = new Set((options && options.replayRecordBlocklist) || []);
    const recentTransitions = [];

    let state = "idle";
    let lastChordReplay = null;
    let currentChordReplay = null;
    let pretracedReplayKeys = [];
    const syntheticReplayEvents = [];
    let engine = null;

    function transition(to, why, data) {
      const from = state;
      state = to || "idle";
      recentTransitions.push({ at: Date.now(), from, to: state, why: why || "", data: clonePlain(data || null) });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function deriveLegacyState(snapshot) {
      if (!snapshot) return "idle";
      const bridge = snapshot.bridge || {};
      const overlay = snapshot.overlay || {};
      const engine = snapshot.engine || {};
      if (bridge.active && !bridge.popupReady) return "bridging-buffering";
      if (bridge.active && bridge.popupReady && overlay.visibility !== "visible") return "bridging-live";
      if (bridge.revealBlocked && !bridge.active && !engine.armed) return "idle";
      if (overlay.visibility === "visible") return "visible";
      if (engine.armed && Array.isArray(engine.path) && engine.path.length > 0) return "armed-prefix";
      if (engine.armed) return "armed-root";
      return "idle";
    }

    function observeLegacyState(snapshot, why) {
      const derived = deriveLegacyState(snapshot);
      if (derived === state) return;
      const error = new Error("[ChordSession] state mismatch");
      error.details = {
        why,
        sessionState: state,
        legacyState: derived,
        snapshot: clonePlain(snapshot),
        recentTransitions: clonePlain(recentTransitions),
      };
      throw error;
    }

    function assertInvariant(snapshot) {
      if (snapshot) observeLegacyState(snapshot, "assertInvariant");
      for (const transition of recentTransitions) {
        if (transition.from === "bridging-buffering" && transition.to === "visible") {
          const error = new Error("[ChordSession] invalid transition");
          error.details = { transition: clonePlain(transition), recentTransitions: clonePlain(recentTransitions) };
          throw error;
        }
      }
      return true;
    }

    function resetCurrentReplay() {
      currentChordReplay = null;
      pretracedReplayKeys = [];
    }

    function trackTerminalAction(payload) {
      if (!payload || !payload.type) return;
      if (payload.type === "action") {
        if (payload.actionId === replayActionId) return;
        lastChordReplay = { kind: "action", actionId: payload.actionId };
      } else if (payload.type === "switch-workspace") {
        lastChordReplay = { kind: "switch-workspace", index: payload.index };
      } else if (payload.type === "open-extension-popup") {
        lastChordReplay = { kind: "open-extension-popup", extensionId: payload.extensionId };
      }
      resetCurrentReplay();
    }

    function trackOpenView(view) {
      // In-flight only — the chain has merely descended into a view. It's
      // not committed as replayable until an action actually fires.
      //
      // Preserve an existing open-view trace during drill navigation. For
      // example, cmd+., q, 1, 2 should replay by opening Domains and then
      // replaying "1, 2"; the intermediate domain-tabs navigate must not
      // replace the root trace with a menu-opening-only trace.
      if (currentChordReplay && currentChordReplay.kind === "open-view") return;
      currentChordReplay = { kind: "open-view", view: view || null, bridgeKeys: [] };
      pretracedReplayKeys = [];
    }

    function trackBridgeKey(keyData) {
      const key = replayKeyFromBridgeKey(keyData);
      if (currentChordReplay && currentChordReplay.kind === "open-view" && key) {
        if (keyData && keyData.__pretraced) {
          currentChordReplay.bridgeKeys.push(key);
          pretracedReplayKeys.push(key);
          return;
        }
        if (pretracedReplayKeys.length > 0 && pretracedReplayKeys[0] === key) {
          pretracedReplayKeys.shift();
          return;
        }
        currentChordReplay.bridgeKeys.push(key);
      }
    }

    function recordPopupAction(message) {
      if (!message || !message.type) return;
      if (replayRecordBlocklist.has(message.type)) return;
      // Engine-fired chord actions (cmd+.,p, cmd+.,w,n, ...) commit via
      // trackTerminalAction at chord-fire time, then the action routes
      // through bg's runChordAction -> recordChordAction -> here for the
      // same action. Without this skip we'd overwrite the engine's
      // kind:"action" record with kind:"action-msg".
      if (lastChordReplay && lastChordReplay.kind === "action" && lastChordReplay.actionId === message.type) {
        currentChordReplay = null;
        return;
      }
      if (
        currentChordReplay &&
        currentChordReplay.kind === "open-view" &&
        Array.isArray(currentChordReplay.bridgeKeys) &&
        currentChordReplay.bridgeKeys.length > 0
      ) {
        lastChordReplay = currentChordReplay;
      } else {
        lastChordReplay = Object.assign({ kind: "action-msg" }, message);
      }
      resetCurrentReplay();
    }

    function acceptEngineEvent(event) {
      if (!event || !event.kind) return;
      if (event.kind === "terminal-action") {
        trackTerminalAction(event.payload);
        transition("completed", "terminal-action", event.payload);
        transition("idle", "terminal-action-idle");
      } else if (event.kind === "open-view") {
        trackOpenView(event.view);
        transition("bridging-buffering", "open-view", { view: event.view });
      } else if (event.kind === "bridge-key") {
        trackBridgeKey(event.keyData);
      } else if (event.kind === "popup-action") {
        recordPopupAction(event.message);
        transition("completed", "popup-action", event.message);
        transition("idle", "popup-action-idle");
      } else if (event.kind === "armed") {
        resetCurrentReplay();
        transition("armed-root", "armed");
      } else if (event.kind === "synthetic-key") {
        syntheticReplayEvents.push({
          at: Date.now(),
          chordKey: event.chordKey || null,
          view: event.view || null,
          activation: event.activation || null,
        });
        if (syntheticReplayEvents.length > 50) syntheticReplayEvents.shift();
        trackBridgeKey({ key: event.chordKey });
      }
    }

    function ensureEngine() {
      if (engine || !options || typeof options.createChordEngine !== "function") return engine;
      engine = options.createChordEngine({
        chordTree: options.chordTree,
        constants: options.constants,
        filterEvent: () => true,
        setTimeoutFn: options.setTimeoutFn,
        clearTimeoutFn: options.clearTimeoutFn,
        onArmed: () => {
          acceptEngineEvent({ kind: "armed" });
          if (typeof options.onArmed === "function") options.onArmed();
        },
        onAction: (payload) => {
          if (typeof options.onAction === "function") options.onAction(payload);
        },
        onOpenView: (view, snapshot, source) => {
          if (typeof options.onOpenView === "function") options.onOpenView(view, snapshot, source);
        },
        onStateChange: (snapshot) => {
          if (typeof options.onStateChange === "function") options.onStateChange(snapshot);
        },
        onCancel: () => {
          if (typeof options.onCancel === "function") options.onCancel();
        },
        onBridgeKey: (keyData) => {
          if (typeof options.onBridgeKey === "function") options.onBridgeKey(keyData);
        },
      });
      return engine;
    }

    function arm() {
      const e = ensureEngine();
      if (e && typeof e.arm === "function") e.arm();
    }

    function handleKey(keyData) {
      const e = ensureEngine();
      if (!e || !keyData || keyData.kind !== "key") return;
      e.handleKey({
        key: keyData.key,
        code: keyData.code,
        shiftKey: !!keyData.shiftKey,
        altKey: !!keyData.altKey,
        ctrlKey: !!keyData.ctrlKey,
        metaKey: !!keyData.metaKey,
        isTrusted: keyData.isTrusted !== false,
        timeStamp: keyData.shimTs,
        target: keyData.target || null,
        preventDefault: typeof keyData.preventDefault === "function" ? keyData.preventDefault : function () {},
        stopPropagation: typeof keyData.stopPropagation === "function" ? keyData.stopPropagation : function () {},
      });
    }

    function resetEngine() {
      const e = ensureEngine();
      if (e && typeof e.reset === "function") e.reset();
    }

    function exitBridge() {
      const e = ensureEngine();
      if (e && typeof e.exitBridge === "function") e.exitBridge();
    }

    function detachEngine() {
      if (engine && typeof engine.detach === "function") engine.detach();
      engine = null;
    }

    function isEngineArmed() {
      const e = ensureEngine();
      return !!(e && typeof e.isArmed === "function" && e.isArmed());
    }

    function getEngineState() {
      const e = ensureEngine();
      return e
        ? { armed: !!e.isArmed(), path: e.serializeState ? e.serializeState() : [] }
        : { armed: false, path: [] };
    }

    function replayLastChord(effects) {
      if (!lastChordReplay || !effects) return false;
      const r = lastChordReplay;
      if (r.kind === "action") {
        return !!(effects.dispatchReplayedAction && effects.dispatchReplayedAction(r.actionId));
      }
      if (r.kind === "switch-workspace") {
        if (effects.dispatchChordAction) effects.dispatchChordAction({ type: "switch-workspace", index: r.index });
        return true;
      }
      if (r.kind === "open-extension-popup") {
        if (effects.dispatchChordAction) effects.dispatchChordAction({ type: "open-extension-popup", extensionId: r.extensionId });
        return true;
      }
      if (r.kind === "open-view") {
        const keysCopy = Array.from(r.bridgeKeys || []);
        if (effects.debug) effects.debug("replay-open-view", { view: r.view, keys: keysCopy });
        if (effects.enterBridgeFromOpenView) effects.enterBridgeFromOpenView(r.view, [], "chrome", "match");
        if (effects.forwardKeyToPopup) {
          for (const k of keysCopy) {
            effects.forwardKeyToPopup({ key: k, code: "", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });
          }
        }
        return true;
      }
      if (r.kind === "action-msg") {
        // Let background fall back to its last popup-action recorder.
        return false;
      }
      return false;
    }

    function hasCurrentOpenViewReplay() {
      return !!(currentChordReplay && currentChordReplay.kind === "open-view");
    }

    function hasCurrentReplay() {
      return !!currentChordReplay;
    }

    function getReplayState() {
      return clonePlain({
        lastChordReplay,
        currentChordReplay,
        pretracedReplayKeys,
        syntheticReplayEvents,
      });
    }

    function getStateSnapshot() {
      return clonePlain({
        state,
        recentTransitions,
      });
    }

    return {
      acceptEngineEvent,
      arm,
      handleKey,
      resetEngine,
      exitBridge,
      detachEngine,
      isEngineArmed,
      getEngineState,
      resetCurrentReplay,
      replayLastChord,
      hasCurrentReplay,
      hasCurrentOpenViewReplay,
      transition,
      observeLegacyState,
      assertInvariant,
      getStateSnapshot,
      getReplayState,
    };
  }

  scope.createChordSession = createChordSession;
})(this);
