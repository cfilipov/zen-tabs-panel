"use strict";

// ChordSession is the chrome-side owner for chord progression, bridge state
// diagnostics, and replay recording. Per-process shims only capture and
// forward keys.
(function (scope) {
  const VALID_STATES = new Set([
    "idle",
    "armed-root",
    "armed-prefix",
    "bridging-buffering",
    "bridging-live",
    "visible",
    "destroying",
    "completed",
    "cancelled",
  ]);

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
    const overlay = options && options.overlay;
    const recentTransitions = [];

    let state = "idle";
    let lastChordReplay = null;
    let currentChordReplay = null;
    let preRecordedReplayKeys = [];
    let revealBlocked = false;
    const bridgeState = {
      revealDeferred: false,
      activeView: null,
      popupReady: false,
      readyTargetView: null,
      buffer: null,
    };
    let bridgeTimer = null;
    let revealTimer = null;
    let lastLeaderArmAt = 0;
    let armSequence = 0;
    let terminalDispatchArmSequence = -1;
    let currentNode = options && options.chordTree;
    let currentPath = [];
    let chordTimer = null;
    let lastAcceptedPhysicalKeySignature = null;
    let lastAcceptedPhysicalKeyFingerprint = null;
    let lastTimeout = null;

    function nowMs() {
      if (options && typeof options.nowFn === "function") {
        try { return options.nowFn(); } catch (e) {}
      }
      return Date.now();
    }

    function transition(to, why, data) {
      const from = state;
      const next = to || "idle";
      if (!VALID_STATES.has(next)) {
        const error = new Error("[ChordSession] unknown state");
        error.details = { from, to: next, why: why || "", validStates: Array.from(VALID_STATES) };
        throw error;
      }
      state = next;
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
        (
          currentChordReplay.kind === "model-row-intent" ||
          (
            currentChordReplay.kind === "open-view" &&
            Array.isArray(currentChordReplay.bridgeKeys) &&
            currentChordReplay.bridgeKeys.length > 0
          )
        )
      ) {
        lastChordReplay = currentChordReplay;
      } else {
        lastChordReplay = Object.assign({ kind: "action-msg" }, message);
      }
      resetCurrentReplay();
    }

    function trackModelRowIntent(event) {
      if (!event || !event.view || !event.chordKey) return;
      const replay = {
        kind: "model-row-intent",
        view: event.view,
        chordKey: event.chordKey,
        switchToTarget: !!event.switchToTarget,
        params: clonePlain(event.params || null),
      };
      if (
        currentChordReplay &&
        currentChordReplay.kind === "open-view" &&
        currentChordReplay.view === replay.view &&
        Array.isArray(currentChordReplay.bridgeKeys) &&
        currentChordReplay.bridgeKeys.length <= 1
      ) {
        currentChordReplay = replay;
        return;
      }
      if (!currentChordReplay) {
        currentChordReplay = replay;
      }
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
      } else if (event.kind === "model-row-intent") {
        trackModelRowIntent(event);
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

    function callOverlay(name /*, ...args */) {
      const fn = overlay && overlay[name];
      if (typeof fn !== "function") return undefined;
      try { return fn.apply(overlay, Array.prototype.slice.call(arguments, 1)); } catch (e) {}
      return undefined;
    }

    function resetTraversal(nextState) {
      clearChordTimer();
      lastTimeout = null;
      currentNode = options && options.chordTree;
      currentPath = [];
      lastAcceptedPhysicalKeySignature = null;
      lastAcceptedPhysicalKeyFingerprint = null;
      if (nextState) transition(nextState, "traversal-reset");
    }

    function physicalKeySignature(keyData) {
      if (!keyData) return null;
      if (keyData.shimSeq == null && keyData.shimTs == null) return null;
      return [
        keyData.source || "",
        keyData.shimSeq == null ? "" : String(keyData.shimSeq),
        keyData.shimTs == null ? "" : String(keyData.shimTs),
        keyData.key || "",
        keyData.code || "",
      ].join(":");
    }

    function physicalKeyTimestamp(keyData) {
      if (!keyData) return null;
      if (typeof keyData.shimTs === "number") return keyData.shimTs;
      if (typeof keyData.timeStamp === "number") return keyData.timeStamp;
      return null;
    }

    function physicalKeyFingerprint(keyData) {
      const ts = physicalKeyTimestamp(keyData);
      if (ts == null) return null;
      return {
        key: keyData.key || "",
        code: keyData.code || "",
        ts,
      };
    }

    function isDuplicatePhysicalKey(keyData) {
      const signature = physicalKeySignature(keyData);
      if (signature && signature === lastAcceptedPhysicalKeySignature) return true;

      const fingerprint = physicalKeyFingerprint(keyData);
      if (
        fingerprint &&
        lastAcceptedPhysicalKeyFingerprint &&
        fingerprint.key === lastAcceptedPhysicalKeyFingerprint.key &&
        fingerprint.code === lastAcceptedPhysicalKeyFingerprint.code &&
        Math.abs(fingerprint.ts - lastAcceptedPhysicalKeyFingerprint.ts) <= 8
      ) {
        return true;
      }

      return false;
    }

    function rememberPhysicalKey(keyData) {
      const signature = physicalKeySignature(keyData);
      if (signature) lastAcceptedPhysicalKeySignature = signature;
      const fingerprint = physicalKeyFingerprint(keyData);
      if (fingerprint) lastAcceptedPhysicalKeyFingerprint = fingerprint;
    }

    function timeoutViewForCurrentNode() {
      const onTo = currentNode && currentNode.onTimeout;
      return onTo && onTo.type === "open-view" ? onTo.view : null;
    }

    function captureTimeout(sideEffect, view, snapshot) {
      lastTimeout = {
        fromState: state,
        currentNode,
        currentPath: snapshot.slice(),
        timerFiredAt: nowMs(),
        sideEffect,
        view: view || null,
      };
    }

    function lateTimeoutForKey(keyData) {
      if (!lastTimeout) return null;
      const ts = physicalKeyTimestamp(keyData);
      if (ts == null || ts >= lastTimeout.timerFiredAt) {
        lastTimeout = null;
        return null;
      }
      const timeout = lastTimeout;
      lastTimeout = null;
      const postTimeoutState = state;
      state = timeout.fromState || "idle";
      currentNode = timeout.currentNode;
      currentPath = Array.isArray(timeout.currentPath) ? timeout.currentPath.slice() : [];
      chordTimer = null;
      recentTransitions.push({ at: Date.now(), from: postTimeoutState, to: state, why: "late-timeout-restore", data: clonePlain({
        key: keyData && keyData.key,
        sideEffect: timeout.sideEffect,
        timerFiredAt: timeout.timerFiredAt,
        shimTs: ts,
      }) });
      if (recentTransitions.length > 50) recentTransitions.shift();
      return timeout;
    }

    function rootTimeout() {
      chordTimer = null;
      const snapshot = currentPath.slice();
      captureTimeout("opened-actions", null, snapshot);
      transition("bridging-buffering", "root-timeout", { snapshot });
      callOption("onOpenView", null, snapshot, "timeout");
    }

    function prefixTimeout() {
      chordTimer = null;
      const snapshot = currentPath.slice();
      const onTo = currentNode && currentNode.onTimeout;
      const view = onTo && onTo.type === "open-view" ? onTo.view : null;
      captureTimeout("opened-prefix-view", view, snapshot);
      transition("bridging-buffering", "prefix-timeout", { view, snapshot });
      callOption("onOpenView", view, snapshot, "timeout");
    }

    function arm() {
      clearChordTimer();
      lastTimeout = null;
      currentNode = options && options.chordTree;
      currentPath = [];
      lastAcceptedPhysicalKeySignature = null;
      lastAcceptedPhysicalKeyFingerprint = null;
      recordEvent({ kind: "armed" });
      callOverlay("create");
      callOption("onArmed");
      const constants = options && options.constants || {};
      setChordTimer(rootTimeout, constants.CHORD_ROOT_TIMEOUT_MS || 500);
    }

    function descend(key, node) {
      currentNode = node;
      currentPath = currentPath.concat([key]);
      transition("armed-prefix", "descend", { path: currentPath });
      if (node && node.onTimeout && node.onTimeout.type === "open-view" && node.onTimeout.view) {
        if (callOverlay("hasPendingReveal")) callOverlay("destroy", { silent: true });
        callOverlay("create", node.onTimeout.view);
      }
      callOption("onStateChange", currentPath.slice());
      const constants = options && options.constants || {};
      setChordTimer(prefixTimeout, node.timeoutMs || constants.CHORD_PREFIX_TIMEOUT_MS || 500);
    }

    function cancelTraversal() {
      const wasArmed = isArmed();
      resetTraversal();
      if (wasArmed) {
        transition("cancelled", "cancel");
        transition("idle", "cancel-idle");
        if (callOverlay("hasPendingReveal")) callOverlay("destroy");
        callOption("onCancel");
      }
    }

    function acceptKey(keyData) {
      if (!keyData || keyData.kind !== "key") return;
      if (keyData.isTrusted === false) return;
      if (keyData.key === "Meta" || keyData.key === "Control" || keyData.key === "Alt" || keyData.key === "Shift") return;
      if (keyData.metaKey || keyData.ctrlKey || keyData.altKey) return;
      if (!isArmed()) return;

      if (isDuplicatePhysicalKey(keyData)) {
        callOption("onDuplicatePhysicalKey", keyData);
        return;
      }
      rememberPhysicalKey(keyData);

      const chordKey = options && typeof options.chordKeyFor === "function"
        ? options.chordKeyFor(keyData)
        : replayKeyFromBridgeKey(keyData);
      if (chordKey == null) return;

      const lateTimeout = lateTimeoutForKey(keyData);

      if (!lateTimeout && (state === "bridging-buffering" || state === "bridging-live")) {
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

      try { if (typeof keyData.preventDefault === "function") keyData.preventDefault(); } catch (e) {}
      try { if (typeof keyData.stopPropagation === "function") keyData.stopPropagation(); } catch (e) {}

      if (chordKey === "Escape") {
        cancelTraversal();
        return;
      }

      const child = currentNode && currentNode.children && currentNode.children[chordKey];
      if (!child) {
        clearChordTimer();
        const snapshot = currentPath.slice();
        const view = timeoutViewForCurrentNode();
        transition("bridging-buffering", "invalid-key", { chordKey, view, snapshot });
        callOption("onInvalidKey", {
          chordKey,
          key: keyData.key,
          code: keyData.code,
          view,
          path: snapshot,
        });
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
        trackOpenView(child.view);
        transition("bridging-buffering", "open-view-match", { view: child.view, snapshot });
        callOption("onOpenView", child.view, snapshot, lateTimeout ? "late-match" : "match");
        return;
      }
      if (child.type === "prefix") {
        if (lateTimeout) {
          currentNode = child;
          currentPath = currentPath.concat([chordKey]);
          clearChordTimer();
          const view = child.onTimeout && child.onTimeout.type === "open-view" ? child.onTimeout.view : null;
          trackOpenView(view);
          transition("bridging-buffering", "late-prefix-match", { view, snapshot: currentPath });
          callOption("onStateChange", currentPath.slice());
          callOption("onOpenView", view, currentPath.slice(), "late-match");
          return;
        }
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
      if (r.kind === "model-row-intent") {
        if (effects.debug) effects.debug("replay-model-row-intent", {
          view: r.view,
          chordKey: r.chordKey,
          switchToTarget: !!r.switchToTarget,
          params: r.params || null,
        });
        return !!(
          effects.dispatchModelRowIntent &&
          effects.dispatchModelRowIntent(r.view, r.chordKey, !!r.switchToTarget, clonePlain(r.params || null))
        );
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
      });
    }

    function getStateSnapshot() {
      return clonePlain({
        state,
        revealBlocked,
        revealDeferred: bridgeState.revealDeferred,
        activeBridgeView: bridgeState.activeView,
        popupReady: bridgeState.popupReady,
        readyTargetView: bridgeState.readyTargetView,
        bridgeBufferLength: Array.isArray(bridgeState.buffer) ? bridgeState.buffer.length : null,
        bridgeTimerActive: bridgeTimer != null,
        revealTimerActive: revealTimer != null,
        lastLeaderArmAt,
        armSequence,
        terminalDispatchArmSequence,
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

    function markOverlayVisible(why) {
      transition("visible", why || "revealOverlay");
    }

    function markOverlayDestroying(options, why) {
      const hard = !!(options && options.hard);
      const silent = !!(options && options.silent);
      if (silent && hasActiveBridge()) {
        transition("bridging-buffering", why || "destroyOverlay-silent", { hard, silent });
        return "bridging-buffering";
      }
      if (!silent) {
        transition("destroying", why || "destroyOverlay", { hard, silent });
        return "destroying";
      }
      return state;
    }

    function markOverlayHidden(why) {
      transition("idle", why || "overlay-hidden");
    }

    function setRevealDeferred(value, why) {
      bridgeState.revealDeferred = !!value;
      if (why) recentTransitions.push({ at: Date.now(), from: state, to: state, why, data: { revealDeferred: bridgeState.revealDeferred } });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function isRevealDeferred() {
      return bridgeState.revealDeferred;
    }

    function deferReveal(why) {
      bridgeState.revealDeferred = true;
      recentTransitions.push({
        at: Date.now(),
        from: state,
        to: state,
        why: why || "reveal-deferred",
        data: { revealDeferred: true },
      });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function consumeDeferredReveal(why) {
      const wasDeferred = bridgeState.revealDeferred;
      bridgeState.revealDeferred = false;
      recentTransitions.push({
        at: Date.now(),
        from: state,
        to: state,
        why: why || "reveal-deferred-clear",
        data: { revealDeferred: false, wasDeferred },
      });
      if (recentTransitions.length > 50) recentTransitions.shift();
      return wasDeferred;
    }

    function setActiveBridgeView(view, why) {
      bridgeState.activeView = view || null;
      if (why) recentTransitions.push({ at: Date.now(), from: state, to: state, why, data: { activeBridgeView: bridgeState.activeView } });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function retargetActiveBridgeView(view, why) {
      const activeView = view || "actions";
      bridgeState.activeView = activeView;
      recentTransitions.push({
        at: Date.now(),
        from: state,
        to: state,
        why: why || "retargetActiveBridgeView",
        data: { activeBridgeView: activeView },
      });
      if (recentTransitions.length > 50) recentTransitions.shift();
      return activeView;
    }

    function getActiveBridgeView() {
      return bridgeState.activeView;
    }

    function hasActiveBridge() {
      return bridgeState.activeView != null;
    }

    function beginBridgeFromOpenView(view, kind, source) {
      const requestedView = view || null;
      const activeView = requestedView || "actions";
      if (bridgeState.activeView != null) {
        if (source !== "late-match") {
          return { mode: "ignored-active-bridge", requestedView, activeView };
        }
        bridgeState.activeView = activeView;
        bridgeState.popupReady = false;
        transition("bridging-buffering", "lateTimeoutOpenView", { view, kind, source });
        return { mode: "retarget-active-bridge", requestedView, activeView };
      }

      bridgeState.buffer = [];
      bridgeState.activeView = activeView;
      bridgeState.popupReady = false;
      transition("bridging-buffering", "enterBridgeFromOpenView", { view, kind, source });
      return { mode: "new-bridge", requestedView, activeView };
    }

    function setPopupReady(value, why) {
      bridgeState.popupReady = !!value;
      if (why) recentTransitions.push({ at: Date.now(), from: state, to: state, why, data: { popupReady: bridgeState.popupReady } });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function isPopupReady() {
      return bridgeState.popupReady;
    }

    function setReadyTargetView(view, why) {
      bridgeState.readyTargetView = view || null;
      if (why) recentTransitions.push({ at: Date.now(), from: state, to: state, why, data: { readyTargetView: bridgeState.readyTargetView } });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function getReadyTargetView() {
      return bridgeState.readyTargetView;
    }

    function prepareReadyTargetView(view, why) {
      const readyTargetView = view || "actions";
      bridgeState.readyTargetView = readyTargetView;
      recentTransitions.push({
        at: Date.now(),
        from: state,
        to: state,
        why: why || "ready-target-view",
        data: { readyTargetView },
      });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function clearReadyTargetView(why) {
      bridgeState.readyTargetView = null;
      recentTransitions.push({
        at: Date.now(),
        from: state,
        to: state,
        why: why || "ready-target-view-clear",
        data: { readyTargetView: null },
      });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function preparePopupLoad(view, why) {
      const readyTargetView = view || "actions";
      bridgeState.popupReady = false;
      bridgeState.readyTargetView = readyTargetView;
      recentTransitions.push({
        at: Date.now(),
        from: state,
        to: state,
        why: why || "preparePopupLoad",
        data: { popupReady: false, readyTargetView },
      });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function startBridgeBuffer(why) {
      bridgeState.buffer = [];
      if (why) recentTransitions.push({ at: Date.now(), from: state, to: state, why, data: { bridgeBufferLength: 0 } });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function clearBridgeBuffer(why) {
      bridgeState.buffer = null;
      if (why) recentTransitions.push({ at: Date.now(), from: state, to: state, why, data: { bridgeBufferLength: null } });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function hasBridgeBuffer() {
      return Array.isArray(bridgeState.buffer);
    }

    function getBridgeBufferLength() {
      return Array.isArray(bridgeState.buffer) ? bridgeState.buffer.length : 0;
    }

    function pushBridgeKey(keyData) {
      if (!Array.isArray(bridgeState.buffer)) return null;
      bridgeState.buffer.push(keyData);
      return bridgeState.buffer.length;
    }

    function drainBridgeBuffer(why) {
      const drained = Array.isArray(bridgeState.buffer) ? bridgeState.buffer : [];
      bridgeState.buffer = [];
      if (why) recentTransitions.push({ at: Date.now(), from: state, to: state, why, data: { drained: drained.length, bridgeBufferLength: 0 } });
      if (recentTransitions.length > 50) recentTransitions.shift();
      return drained;
    }

    function markPopupReady(why, options) {
      const wasBridging = hasActiveBridge();
      const drained = drainBridgeBuffer(why);
      const readyView = bridgeState.readyTargetView || "actions";
      bridgeState.popupReady = true;
      if (wasBridging) {
        transition("bridging-live", why || "popup-ready", { drained: drained.length, view: readyView });
      }
      if (options && options.clearReadyTarget) {
        bridgeState.readyTargetView = null;
        recentTransitions.push({ at: Date.now(), from: state, to: state, why: "ready-target-view-clear", data: { readyTargetView: null } });
        if (recentTransitions.length > 50) recentTransitions.shift();
      }
      return { wasBridging, drained, readyView };
    }

    function finishBridge(w, why) {
      clearBridgeTimer(w);
      clearRevealTimer(w);
      bridgeState.buffer = null;
      bridgeState.popupReady = false;
      bridgeState.revealDeferred = false;
      exitBridge();
      bridgeState.activeView = null;
      transition("idle", why || "finishBridge");
    }

    function clearBridgeTimer(w) {
      if (bridgeTimer !== null && w) {
        try { w.clearTimeout(bridgeTimer); } catch (e) {}
      }
      bridgeTimer = null;
    }

    function armBridgeTimer(w, delay, callback) {
      clearBridgeTimer(w);
      if (!w) return;
      bridgeTimer = w.setTimeout(() => {
        bridgeTimer = null;
        if (callback) callback();
      }, delay);
    }

    function isBridgeTimerActive() {
      return bridgeTimer != null;
    }

    function clearRevealTimer(w, why) {
      if (revealTimer !== null && w) {
        try { w.clearTimeout(revealTimer); } catch (e) {}
      }
      revealTimer = null;
      if (bridgeState.revealDeferred) {
        bridgeState.revealDeferred = false;
        recentTransitions.push({
          at: Date.now(),
          from: state,
          to: state,
          why: why || "reveal-deferred-clear",
          data: { revealDeferred: false },
        });
        if (recentTransitions.length > 50) recentTransitions.shift();
      }
    }

    function armRevealTimer(w, delay, callback) {
      clearRevealTimer(w);
      if (!w) return;
      revealTimer = w.setTimeout(() => {
        revealTimer = null;
        if (callback) callback();
      }, delay);
    }

    function isRevealTimerActive() {
      return revealTimer != null;
    }

    function leaderArmElapsed(now) {
      const value = typeof now === "number" ? now : nowMs();
      return value - lastLeaderArmAt;
    }

    function shouldDebounceLeaderArm(now, threshold) {
      return leaderArmElapsed(now) < (typeof threshold === "number" ? threshold : 80);
    }

    function markLeaderArm(now) {
      lastLeaderArmAt = typeof now === "number" ? now : nowMs();
      return lastLeaderArmAt;
    }

    function beginArm(now) {
      markLeaderArm(now);
      armSequence++;
      terminalDispatchArmSequence = -1;
      recentTransitions.push({ at: Date.now(), from: state, to: state, why: "begin-arm", data: { armSequence, lastLeaderArmAt } });
      if (recentTransitions.length > 50) recentTransitions.shift();
    }

    function markTerminalDispatch() {
      if (terminalDispatchArmSequence === armSequence) return false;
      terminalDispatchArmSequence = armSequence;
      return true;
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
      markOverlayVisible,
      markOverlayDestroying,
      markOverlayHidden,
      setRevealDeferred,
      isRevealDeferred,
      deferReveal,
      consumeDeferredReveal,
      setActiveBridgeView,
      retargetActiveBridgeView,
      getActiveBridgeView,
      hasActiveBridge,
      beginBridgeFromOpenView,
      setPopupReady,
      isPopupReady,
      setReadyTargetView,
      getReadyTargetView,
      prepareReadyTargetView,
      clearReadyTargetView,
      preparePopupLoad,
      startBridgeBuffer,
      clearBridgeBuffer,
      hasBridgeBuffer,
      getBridgeBufferLength,
      pushBridgeKey,
      drainBridgeBuffer,
      markPopupReady,
      finishBridge,
      clearBridgeTimer,
      armBridgeTimer,
      isBridgeTimerActive,
      clearRevealTimer,
      armRevealTimer,
      isRevealTimerActive,
      leaderArmElapsed,
      shouldDebounceLeaderArm,
      markLeaderArm,
      beginArm,
      markTerminalDispatch,
    };
  }

  scope.createChordSession = createChordSession;
})(this);
