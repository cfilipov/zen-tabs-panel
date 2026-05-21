"use strict";

// Capture-only chord shim.
//
// The shim owns no chord-tree state. When armed, it synchronously suppresses
// non-modifier keydowns in its process and forwards a normalized key payload
// to chrome. Chord progression lives in the chrome-side ChordSession.
(function (scope) {
  function isModifierKey(e) {
    return e && (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift");
  }

  function isModifierCombo(e) {
    return !!(e && (e.metaKey || e.ctrlKey || e.altKey));
  }

  function normalizeKeyEvent(e, seq) {
    return {
      kind: "key",
      key: e && e.key,
      code: e && e.code,
      shiftKey: !!(e && e.shiftKey),
      altKey: !!(e && e.altKey),
      ctrlKey: !!(e && e.ctrlKey),
      metaKey: !!(e && e.metaKey),
      shimSeq: seq,
      // Use wall-clock time so content-process key timestamps can be compared
      // against chrome-process timeout timestamps.
      shimTs: Date.now(),
    };
  }

  function createChordShim(opts) {
    opts = opts || {};
    const forwardKey = opts.forwardKey;
    const filterEvent = opts.filterEvent;
    const onArmed = opts.onArmed;
    const onDisarmed = opts.onDisarmed;
    const failsafeTimeoutMs = typeof opts.failsafeTimeoutMs === "number" ? opts.failsafeTimeoutMs : 5000;
    const setT = opts.setTimeoutFn || (typeof globalThis !== "undefined" ? globalThis.setTimeout : null);
    const clearT = opts.clearTimeoutFn || (typeof globalThis !== "undefined" ? globalThis.clearTimeout : null);

    let armed = false;
    let attachedTarget = null;
    let keydownBound = null;
    let blurBound = null;
    let failsafeTimer = null;
    let seq = 0;

    function clearFailsafe() {
      if (failsafeTimer !== null && clearT) {
        try { clearT(failsafeTimer); } catch (e) {}
      }
      failsafeTimer = null;
    }

    function armFailsafe() {
      clearFailsafe();
      if (!setT || failsafeTimeoutMs <= 0) return;
      failsafeTimer = setT(() => {
        failsafeTimer = null;
        disarm("failsafe");
      }, failsafeTimeoutMs);
    }

    function arm() {
      armed = true;
      armFailsafe();
      if (typeof onArmed === "function") {
        try { onArmed(); } catch (e) {}
      }
    }

    function disarm(reason) {
      if (!armed && failsafeTimer === null) return;
      armed = false;
      clearFailsafe();
      if (typeof onDisarmed === "function") {
        try { onDisarmed(reason || "disarm"); } catch (e) {}
      }
    }

    function handleKey(e) {
      if (filterEvent && !filterEvent(e)) return;
      if (!e || e.isTrusted === false) return;
      if (isModifierKey(e)) return;
      if (isModifierCombo(e)) return;
      if (!armed) return;

      try { Object.defineProperty(e, "__zenTabsPanelChordHandled", { value: true }); } catch (_) {}
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}

      seq += 1;
      armFailsafe();
      if (typeof forwardKey === "function") {
        try { forwardKey(normalizeKeyEvent(e, seq)); } catch (_) {}
      }
    }

    function handleBlur(e) {
      if (filterEvent && !filterEvent(e)) return;
      disarm("blur");
    }

    function attach(target) {
      if (attachedTarget) detach();
      attachedTarget = target;
      keydownBound = handleKey;
      blurBound = handleBlur;
      target.addEventListener("keydown", keydownBound, { capture: true, mozSystemGroup: true });
      target.addEventListener("blur", blurBound, { capture: true, mozSystemGroup: true });
    }

    function detach() {
      if (!attachedTarget) return;
      try { attachedTarget.removeEventListener("keydown", keydownBound, { capture: true, mozSystemGroup: true }); } catch (e) {}
      try { attachedTarget.removeEventListener("blur", blurBound, { capture: true, mozSystemGroup: true }); } catch (e) {}
      attachedTarget = null;
      keydownBound = blurBound = null;
      disarm("detach");
    }

    return {
      attach,
      detach,
      handleKey,
      arm,
      disarm,
      isArmed() { return armed; },
    };
  }

  scope.createChordShim = createChordShim;
})(this);
