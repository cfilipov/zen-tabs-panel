"use strict";

// ChordSession is the chrome-side owner for chord progression, bridge state
// diagnostics, and replay recording. Per-process shims only capture and
// forward keys.
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

  function bridgeKeyFromReplayKey(key) {
    const raw = String(key || "");
    const shiftedDigit = /^Shift\+([1-9])$/.exec(raw);
    if (shiftedDigit) {
    return {
        key: raw,
        code: "Digit" + shiftedDigit[1],
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      };
    }
    const shiftedLetter = /^Shift\+([A-Z])$/.exec(raw);
    if (shiftedLetter) {
      return {
        key: shiftedLetter[1],
        code: "Key" + shiftedLetter[1],
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      };
    }
    const letter = /^[A-Z]$/.exec(raw);
    if (letter) {
      return {
        key: raw.toLowerCase(),
        code: "Key" + raw,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      };
    }
    const digit = /^[1-9]$/.exec(raw);
    if (digit) {
      return {
        key: raw,
        code: "Digit" + raw,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      };
    }
    return {
      key: raw,
      code: "",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    };
  }

  function createChordSession(options) {
    const replayActionId = options && options.replayActionId;
    const replayRecordBlocklist = new Set((options && options.replayRecordBlocklist) || []);
    const recentTransitions = [];

    let state = "idle";
    let lastChordReplay = null;
    let currentChordReplay = null;
    let preRecordedReplayKeys = [];
    const syntheticReplayEvents = [];
    let revealBlocked = false;
    let revealDeferred = false;
    let activeBridgeView = null;
    let currentNode = options && options.chordTree;
    let currentPath = [];
    let chordTimer = null;

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
      const session = snapshot.session || {};
      const traversal = snapshot.traversal || {};
      if (bridge.active && !bridge.popupReady) return "bridging-buffering";
      if (bridge.active && bridge.popupReady && overlay.pendingReveal) return "bridging-live";
      if (bridge.active && bridge.popupReady && overlay.visibility !== "visible") return "bridging-live";
      if (session.revealBlocked && !bridge.active && !traversal.armed) return "idle";
      if (overlay.visibility === "visible" && !overlay.pendingReveal) return "visible";
      if (traversal.armed && Array.isArray(traversal.path) && traversal.path.length > 0) return "armed-prefix";
      if (traversal.armed) return "armed-root";
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
      preRecordedReplayKeys = [];
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
      preRecordedReplayKeys = [];
    }

    function trackBridgeKey(keyData) {
      const key = replayKeyFromBridgeKey(keyData);
      if (currentChordReplay && currentChordReplay.kind === "open-view" && key) {
        if (keyData && keyData.__preRecorded) {
          currentChordReplay.bridgeKeys.push(key);
          preRecordedReplayKeys.push(key);
          return;
        }
        if (preRecordedReplayKeys.length > 0 && preRecordedReplayKeys[0] === key) {
          preRecordedReplayKeys.shift();
          return;
        }
        currentChordReplay.bridgeKeys.push(key);
      }
    }

    function recordPopupAction(message) {
      if (!message || !message.type) return;
      if (replayRecordBlocklist.has(message.type)) return;
      // ChordSession-fired chord actions (cmd+.,p, cmd+.,w,n, ...) commit via
      // trackTerminalAction at chord-fire time, then the action routes
      // through bg's runChordAction -> recordChordAction -> here for the
      // same action. Without this skip we'd overwrite the chord trace's
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

    function recordEvent(event) {
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

    function clearChordTimer() {
      if (chordTimer !== null && options && typeof options.clearTimeoutFn === "function") {
        try { options.clearTimeoutFn(chordTimer); } catch (e) {}
      }
      chordTimer = null;
    }

    function setChordTimer(fn, ms) {
      clearChordTimer();
      if (!options || typeof options.setTimeoutFn !== "function") return;
      chordTimer = options.setTimeoutFn(fn, ms);
    }

    function callOption(name /*, ...args */) {
      const fn = options && options[name];
      if (typeof fn !== "function") return;
      try { fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) {}
    }

    function resetTraversal(nextState) {
      clearChordTimer();
      currentNode = options && options.chordTree;
      currentPath = [];
      if (nextState) transition(nextState, "traversal-reset");
    }

    function rootTimeout() {
      chordTimer = null;
      const snapshot = currentPath.slice();
      transition("bridging-buffering", "root-timeout", { snapshot });
      callOption("onOpenView", null, snapshot, "timeout");
    }

    function prefixTimeout() {
      chordTimer = null;
      const snapshot = currentPath.slice();
      const onTo = currentNode && currentNode.onTimeout;
      const view = onTo && onTo.type === "open-view" ? onTo.view : null;
      transition("bridging-buffering", "prefix-timeout", { view, snapshot });
      callOption("onOpenView", view, snapshot, "timeout");
    }

    function arm() {
      clearChordTimer();
      currentNode = options && options.chordTree;
      currentPath = [];
      recordEvent({ kind: "armed" });
      callOption("onArmed");
      const constants = options && options.constants || {};
      setChordTimer(rootTimeout, constants.CHORD_ROOT_TIMEOUT_MS || 500);
    }

    function descend(key, node) {
      currentNode = node;
      currentPath = currentPath.concat([key]);
      transition("armed-prefix", "descend", { path: currentPath });
      callOption("onStateChange", currentPath.slice());
      const constants = options && options.constants || {};
      setChordTimer(prefixTimeout, node.timeoutMs || constants.CHORD_PREFIX_TIMEOUT_MS || 500);
    }

    function cancelTraversal() {
      const wasArmed = isArmed();
      resetTraversal("idle");
      if (wasArmed) callOption("onCancel");
    }

    function acceptKey(keyData) {
      if (!keyData || keyData.kind !== "key") return;
      if (keyData.isTrusted === false) return;
      if (keyData.key === "Meta" || keyData.key === "Control" || keyData.key === "Alt" || keyData.key === "Shift") return;
      if (keyData.metaKey || keyData.ctrlKey || keyData.altKey) return;
      if (!isArmed()) return;

      if (state === "bridging-buffering" || state === "bridging-live") {
        try { if (typeof keyData.preventDefault === "function") keyData.preventDefault(); } catch (e) {}
        try { if (typeof keyData.stopPropagation === "function") keyData.stopPropagation(); } catch (e) {}
        callOption("onBridgeKey", {
          key: keyData.key,
          code: keyData.code,
          shiftKey: !!keyData.shiftKey,
          altKey: !!keyData.altKey,
          ctrlKey: !!keyData.ctrlKey,
          metaKey: !!keyData.metaKey,
          shimSeq: keyData.shimSeq,
          shimTs: keyData.shimTs,
        });
        return;
      }

      const chordKey = options && typeof options.chordKeyFor === "function"
        ? options.chordKeyFor(keyData)
        : replayKeyFromBridgeKey(keyData);
      if (chordKey == null) return;

      try { if (typeof keyData.preventDefault === "function") keyData.preventDefault(); } catch (e) {}
      try { if (typeof keyData.stopPropagation === "function") keyData.stopPropagation(); } catch (e) {}

      if (chordKey === "Escape") {
        cancelTraversal();
        return;
      }

      const child = currentNode && currentNode.children && currentNode.children[chordKey];
      if (!child) {
        cancelTraversal();
        return;
      }

      if (child.type === "action") {
        const payload = { type: "action", actionId: child.actionId };
        resetTraversal("idle");
        callOption("onAction", payload);
        return;
      }
      if (child.type === "switch-workspace") {
        const payload = { type: "switch-workspace", index: child.index };
        resetTraversal("idle");
        callOption("onAction", payload);
        return;
      }
      if (child.type === "open-extension-popup") {
        const payload = { type: "open-extension-popup", extensionId: child.extensionId };
        resetTraversal("idle");
        callOption("onAction", payload);
        return;
      }
      if (child.type === "open-view") {
        const snapshot = currentPath.concat([chordKey]);
        currentPath = snapshot;
        clearChordTimer();
        transition("bridging-buffering", "open-view-match", { view: child.view, snapshot });
        callOption("onOpenView", child.view, snapshot, "match");
        return;
      }
      if (child.type === "prefix") {
        descend(chordKey, child);
      }
    }

    function reset() {
      resetTraversal("idle");
    }

    function exitBridge() {
      if (state === "bridging-buffering" || state === "bridging-live") resetTraversal("idle");
    }

    function detach() {
      resetTraversal("idle");
    }

    function isArmed() {
      return state === "armed-root" || state === "armed-prefix" || state === "bridging-buffering" || state === "bridging-live";
    }

    function getTraversalState() {
      return { armed: isArmed(), path: currentPath.slice() };
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
        if (effects.enterBridgeFromOpenView) effects.enterBridgeFromOpenView(r.view, "chrome", "match");
        if (effects.forwardKeyToPopup) {
          for (const k of keysCopy) {
            effects.forwardKeyToPopup(bridgeKeyFromReplayKey(k));
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
        preRecordedReplayKeys,
        syntheticReplayEvents,
      });
    }

    function getStateSnapshot() {
      return clonePlain({
        state,
        revealBlocked,
        revealDeferred,
        activeBridgeView,
        recentTransitions,
      });
    }

    function setRevealBlocked(value, why) {
      revealBlocked = !!value;
      if (revealBlocked) {
        transition(state, why || "reveal-blocked", { revealBlocked });
      }
    }

    function isRevealBlocked() {
      return revealBlocked;
    }

    function setRevealDeferred(value, why) {
      revealDeferred = !!value;
      if (why) recentTransitions.push({ at: Date.now(), from: state, to: state, why, data: { revealDeferred } });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function isRevealDeferred() {
      return revealDeferred;
    }

    function setActiveBridgeView(view, why) {
      activeBridgeView = view || null;
      if (why) recentTransitions.push({ at: Date.now(), from: state, to: state, why, data: { activeBridgeView } });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function getActiveBridgeView() {
      return activeBridgeView;
    }

    function hasActiveBridge() {
      return activeBridgeView != null;
    }

    return {
      recordEvent,
      arm,
      acceptKey,
      reset,
      exitBridge,
      detach,
      isArmed,
      getTraversalState,
      resetCurrentReplay,
      replayLastChord,
      hasCurrentReplay,
      hasCurrentOpenViewReplay,
      transition,
      observeLegacyState,
      assertInvariant,
      getStateSnapshot,
      getReplayState,
      setRevealBlocked,
      isRevealBlocked,
      setRevealDeferred,
      isRevealDeferred,
      setActiveBridgeView,
      getActiveBridgeView,
      hasActiveBridge,
    };
  }

  scope.createChordSession = createChordSession;
})(this);
