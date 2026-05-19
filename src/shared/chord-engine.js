"use strict";

// Chord state machine — pure logic, no I/O.
//
// Loaded by:
//   - chrome (experiment/api.js)        via Services.scriptloader.loadSubScript
//   - per-content-process actor child   via Services.scriptloader.loadSubScript
//
// Each consumer instantiates with environment-specific callbacks; the engine
// itself owns the state machine and the chord-tree traversal. State is local
// to each instance — there is no cross-process state projection, so there is
// no race window for any state transition.
//
// The engine has no auto-arming logic — it's armed externally by the owner
// (chrome/content frame script when commands.onCommand for one of the
// open-palette shortcuts fires → api.armChord). Once armed, subsequent
// chord keys typed in the engine's domain are processed and matched
// against the chord tree.
//
// API:
//   createChordEngine({
//     chordTree,         // built via buildChordTree below
//     constants,         // { CHORD_ROOT_TIMEOUT_MS, CHORD_PREFIX_TIMEOUT_MS }
//     filterEvent,       // (e) => boolean — does this engine own this event?
//     setTimeoutFn,      // optional, defaults to globalThis.setTimeout
//     clearTimeoutFn,    // optional, defaults to globalThis.clearTimeout
//     disableTimers,     // optional; popup sets true (no root/prefix timeouts in menu)
//     onArmed,           // () => void
//     onAction,          // ({type:"action"|"switch-workspace"|"open-extension-popup", ...}) => void
//     onOpenView,        // (viewName | null, stateSnapshot) => void — engine transitions to bridging
//     onStateChange,     // (snapshot) => void — current node descended (popup re-renders)
//     onCancel,          // () => void
//     onBridgeKey,       // (keyDescriptor) => void — non-modifier key captured during bridging
//   }) → {
//     attach(target),       // installs keydown/blur listeners
//     detach(),
//     handleKey(eventLike), // direct entry point for tests/specialized callers
//     setInitialState(snapshot),
//     exitBridge(),
//     reset(),
//     arm(),                // external trigger; called by chrome's armChord
//     isArmed(),
//     serializeState() → string[]
//   }
//
//   buildChordTree(KEYBINDINGS, WORKSPACE_DIGIT_CHORDS, constants) → tree
//   chordKeyFor(e) → string | null
//
// The chord tree is a tree of nodes:
//   { type: "action",            actionId }
//   { type: "open-view",         view }
//   { type: "switch-workspace",  index }
//   { type: "open-extension-popup", extensionId }   (added dynamically at runtime)
//   { type: "prefix",            timeoutMs, onTimeout, children: {chordKey: node} }
//
// The root node has the same shape as a prefix node minus the type ({children:{}}).
//
// Bridging: when the engine fires `open-view` (either from a terminal
// open-view match or from a root/prefix timeout), it transitions to
// `bridging` and continues to capture non-modifier keys, routing them to
// `onBridgeKey`. The owner buffers these and replays them into the popup
// after `MSG.POPUP_READY` is drained. The owner calls `exitBridge()` when
// the popup has taken over.

(function (scope) {
  // ---------------------------------------------------------------------
  // Pure helpers (no engine state)
  // ---------------------------------------------------------------------

  // Map a keydown event to the chord-tree key string used in shared/keybindings.js,
  // or null if the event should be ignored (pure modifier press, or
  // modifier-co-pressed key that should fall through to the OS/browser).
  function chordKeyFor(e) {
    if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") return null;
    if (e.metaKey || e.ctrlKey || e.altKey) return null;
    if (e.key === "Escape") return "Escape";
    if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
      const upper = e.key.toUpperCase();
      return e.shiftKey ? "Shift+" + upper : upper;
    }
    // Shift+digit produces a layout-dependent symbol via e.key (Shift+1 = "!"
    // on US, etc.), so recover the digit from e.code for the extension-popup
    // quick-launch chords.
    if (e.shiftKey && e.code && /^Digit[1-9]$/.test(e.code)) {
      return "Shift+" + e.code.slice(5);
    }
    return e.key;
  }

  // Build the chord tree from the keybindings registry. Same shape used by
  // every engine instance so a serialized state snapshot (a path of chord
  // keys) resolves to the same node everywhere.
  function buildChordTree(KEYBINDINGS, WORKSPACE_DIGIT_CHORDS, constants) {
    function buildNode(entry) {
      if (entry.kind === "action") return { type: "action", actionId: entry.id };
      if (entry.kind === "open-view") return { type: "open-view", view: entry.view };
      if (entry.kind === "prefix") {
        const children = Object.create(null);
        for (const child of (entry.children || [])) {
          children[child.chord] = buildNode(child);
        }
        return {
          type: "prefix",
          timeoutMs: constants.CHORD_PREFIX_TIMEOUT_MS,
          onTimeout: { type: "open-view", view: entry.view },
          children,
        };
      }
      return null;
    }

    const tree = { children: Object.create(null) };
    for (const entry of (KEYBINDINGS || [])) {
      const node = buildNode(entry);
      if (node) tree.children[entry.chord] = node;
    }
    for (let i = 0; i < (WORKSPACE_DIGIT_CHORDS || []).length; i++) {
      tree.children[WORKSPACE_DIGIT_CHORDS[i]] = { type: "switch-workspace", index: i };
    }
    return tree;
  }

  // ---------------------------------------------------------------------
  // Engine factory
  // ---------------------------------------------------------------------

  function createChordEngine(opts) {
    const {
      chordTree,
      constants,
      filterEvent,
      disableTimers,
      onArmed,
      onAction,
      onOpenView,
      onStateChange,
      onCancel,
      onBridgeKey,
    } = opts;

    // Timer functions — prefer explicit injection (chrome can use a Window
    // reference's setTimeout for the right scope). Fall back to the ambient
    // globalThis ones.
    const setT = (opts.setTimeoutFn || (typeof globalThis !== "undefined" ? globalThis.setTimeout : null));
    const clearT = (opts.clearTimeoutFn || (typeof globalThis !== "undefined" ? globalThis.clearTimeout : null));

    // State machine.
    let state = "idle"; // "idle" | "armed-root" | "armed-prefix" | "bridging"
    let currentNode = chordTree;
    let currentPath = []; // chord-key path from root to currentNode

    let chordTimer = null;

    // Listener bookkeeping for detach().
    let attachedTarget = null;
    let keydownBound = null;
    let blurBound = null;

    function safeCall(fn /*, ...args */) {
      if (typeof fn !== "function") return;
      try { fn.apply(null, Array.prototype.slice.call(arguments, 1)); }
      catch (e) { /* swallow — engine must not throw into the listener path */ }
    }

    function clearChordTimer() {
      if (chordTimer !== null && clearT) {
        try { clearT(chordTimer); } catch (e) {}
      }
      chordTimer = null;
    }

    function rootTimeout() {
      chordTimer = null;
      const snapshot = currentPath.slice();
      state = "bridging";
      // Source "timeout" tells the chrome handler the user passively let
      // the chord wait expire — the menu should reveal now. Distinct from
      // an explicit open-view chord-key match, which keeps the popup
      // hidden so a fast chord chain can navigate without ever showing UI.
      safeCall(onOpenView, null, snapshot, "timeout");
    }

    function prefixTimeout() {
      chordTimer = null;
      const snapshot = currentPath.slice();
      const onTo = currentNode && currentNode.onTimeout;
      state = "bridging";
      if (onTo && onTo.type === "open-view") {
        safeCall(onOpenView, onTo.view, snapshot, "timeout");
      } else {
        safeCall(onOpenView, null, snapshot, "timeout");
      }
    }

    function arm() {
      clearChordTimer();
      state = "armed-root";
      currentNode = chordTree;
      currentPath = [];
      safeCall(onArmed);
      if (!disableTimers && setT) {
        chordTimer = setT(rootTimeout, constants.CHORD_ROOT_TIMEOUT_MS);
      }
    }

    function descend(key, node) {
      clearChordTimer();
      state = "armed-prefix";
      currentNode = node;
      currentPath = currentPath.concat([key]);
      safeCall(onStateChange, currentPath.slice());
      if (!disableTimers && setT) {
        chordTimer = setT(prefixTimeout, node.timeoutMs || constants.CHORD_PREFIX_TIMEOUT_MS);
      }
    }

    function reset() {
      clearChordTimer();
      state = "idle";
      currentNode = chordTree;
      currentPath = [];
    }

    function cancel() {
      const wasArmed = (state !== "idle");
      reset();
      if (wasArmed) safeCall(onCancel);
    }

    // ---- core keydown handler ------------------------------------------
    function handleKey(e) {
      // 1. Filter: only act on events this engine owns (e.g. chrome engine
      //    skips events whose target is a <browser>).
      if (filterEvent && !filterEvent(e)) return;

      // 2. Ignore synthetic events to prevent pages from triggering chord
      //    actions via dispatchEvent. Tests/specialized callers can use
      //    handleKey directly; disableTimers mode still accepts event-like
      //    objects because it is used outside page-owned input streams.
      if (!e.isTrusted && !disableTimers) return;

      // 3. Pure modifier keydowns (Meta/Control/Alt/Shift alone): ignore.
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") return;

      // 4. Modifier-co-pressed keys (cmd+T, ctrl+L, etc.) are NOT chord
      //    keys. Don't capture them. They flow through to the OS / Firefox.
      //    The configurable open-palette shortcuts ARE modifier combos
      //    (cmd+., option+., etc.), but they're matched by Firefox's
      //    keyset at chrome level and dispatched via commands.onCommand →
      //    api.armChord() — they never reach this listener as a keydown.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // 5. If not armed, pass through. Hot path for normal typing.
      if (state === "idle") return;

      // 6. Bridging: a panel is opening but its keyboard handler isn't yet
      //    live. Capture all non-modifier keys; forward to the owner's
      //    bridge buffer for replay into the popup.
      if (state === "bridging") {
        try { Object.defineProperty(e, "__zenTabsPanelChordHandled", { value: true }); } catch (_) {}
        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}
        safeCall(onBridgeKey, {
          key: e.key,
          code: e.code,
          shiftKey: !!e.shiftKey,
          altKey: !!e.altKey,
          ctrlKey: !!e.ctrlKey,
          metaKey: !!e.metaKey,
        });
        return;
      }

      // 8. Armed (root or prefix): the engine owns this keystroke.
      //    preventDefault unconditionally so unknown keys don't leak — chord
      //    cancellation eats the key.
      const k = chordKeyFor(e);
      if (k === null) return; // pure modifier — already filtered above

      try { Object.defineProperty(e, "__zenTabsPanelChordHandled", { value: true }); } catch (_) {}
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}

      if (k === "Escape") {
        cancel();
        return;
      }

      const child = currentNode && currentNode.children && currentNode.children[k];
      if (!child) {
        cancel();
        return;
      }

      // 9. Dispatch on the matched node's type.
      if (child.type === "action") {
        const id = child.actionId;
        reset();
        safeCall(onAction, { type: "action", actionId: id });
        return;
      }
      if (child.type === "switch-workspace") {
        const index = child.index;
        reset();
        safeCall(onAction, { type: "switch-workspace", index });
        return;
      }
      if (child.type === "open-extension-popup") {
        const extensionId = child.extensionId;
        reset();
        safeCall(onAction, { type: "open-extension-popup", extensionId });
        return;
      }
      if (child.type === "open-view") {
        const view = child.view;
        const snapshot = currentPath.concat([k]);
        currentPath = snapshot;
        state = "bridging";
        clearChordTimer();
        // Source "match" — explicit chord-key open-view. Chrome keeps the
        // popup invisible and starts a reveal-on-pause timer so fast chord
        // chains complete without ever showing UI.
        safeCall(onOpenView, view, snapshot, "match");
        return;
      }
      if (child.type === "prefix") {
        descend(k, child);
        return;
      }
    }

    // ---- blur: focus left our target, cancel any in-flight chord -------
    function handleBlur(e) {
      if (filterEvent && !filterEvent(e)) return;
      if (state === "idle") return;
      cancel();
    }

    // ---- attach/detach -------------------------------------------------
    function attach(target) {
      if (attachedTarget) detach();
      attachedTarget = target;
      keydownBound = handleKey;
      blurBound = handleBlur;
      // System event group + capture phase: highest priority on the target.
      target.addEventListener("keydown", keydownBound, { capture: true, mozSystemGroup: true });
      target.addEventListener("blur",    blurBound,    { capture: true, mozSystemGroup: true });
    }

    function detach() {
      if (!attachedTarget) return;
      try { attachedTarget.removeEventListener("keydown", keydownBound, { capture: true, mozSystemGroup: true }); } catch (e) {}
      try { attachedTarget.removeEventListener("blur",    blurBound,    { capture: true, mozSystemGroup: true }); } catch (e) {}
      attachedTarget = null;
      keydownBound = blurBound = null;
      clearChordTimer();
    }

    // ---- state hand-off (popup uses this on POPUP_READY) ---------------
    function setInitialState(snapshot) {
      reset();
      if (!snapshot || !snapshot.length) {
        state = "armed-root";
        currentNode = chordTree;
        currentPath = [];
        return;
      }
      let node = chordTree;
      for (const key of snapshot) {
        if (!node || !node.children || !node.children[key]) {
          // Snapshot doesn't resolve in this tree (extension popup chords
          // added dynamically in chrome but not yet known here, etc.). Fall
          // back to root.
          state = "armed-root";
          currentNode = chordTree;
          currentPath = [];
          return;
        }
        node = node.children[key];
      }
      state = "armed-prefix";
      currentNode = node;
      currentPath = snapshot.slice();
    }

    function exitBridge() {
      if (state === "bridging") reset();
    }

    function isArmed() {
      return state !== "idle";
    }

    function serializeState() {
      return currentPath.slice();
    }

    return {
      attach,
      detach,
      handleKey,
      setInitialState,
      exitBridge,
      reset,
      arm,           // exposed so an external trigger (commands.onCommand
                     // for any of the configurable open-palette shortcuts)
                     // can force the engine into armed-root from outside
                     // the keydown path
      isArmed,
      serializeState,
    };
  }

  scope.createChordEngine = createChordEngine;
  scope.buildChordTree = buildChordTree;
  scope.chordKeyFor = chordKeyFor;
})(this);
