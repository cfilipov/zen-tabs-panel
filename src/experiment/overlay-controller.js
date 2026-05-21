"use strict";

// Adapter boundary for a future ChordSession-owned overlay lifecycle.
//
// ChordSession should decide *when* the palette overlay is created, rearmed,
// revealed, swapped, or destroyed. The implementation should stay here in
// chrome/XUL land because it touches DOM nodes, XUL <browser> elements, panel
// sizing, animation settings, hosted extension popups, and focus.
//
// The controller starts with popup-instance ownership because that is pure
// overlay state: it exists only to reject stale POPUP_READY / REVEAL_PALETTE
// messages from a replaced hosted browser.

/**
 * @typedef {Object} OverlayController
 *
 * @property {(view?: string | null, params?: Object | null) => void} create
 * Create a fresh overlay browser at `view`. Must assign a new popup instance
 * for cold creates, set the popup URL with generation/instance params, install
 * load kicks, initialize panel size, and leave the overlay hidden behind a
 * pending reveal closure unless the caller explicitly reveals it later.
 *
 * @property {(view?: string | null, params?: Object | null) => void} rearm
 * Reuse a warm hidden overlay for a new chord arm. Must not bump popup instance;
 * must send WarmRearm, clear stale ready/reveal state, and preserve any bridge
 * keys that arrive while the popup reinitializes.
 *
 * @property {({ silent?: boolean, hard?: boolean }=) => void} destroy
 * Destroy or soft-hide the overlay. `silent:true` means prerender swap: preserve
 * bridge buffers and do not finish the chord bridge. Non-silent destroy must
 * block late reveal timers and reset bridge ownership.
 *
 * @property {() => void} reveal
 * Make the pending overlay visible. Must honor skip-animation settings, focus
 * the hosted browser, notify the popup that the palette is revealed, and leave
 * shims disarmed because visible popup interaction is modal.
 *
 * @property {(view: string, params?: Object | null) => void} morphTo
 * Swap the hosted browser when crossing into or out of a foreign extension
 * popup. Must preserve panel animation semantics and extension popup sizing.
 *
 * @property {() => boolean} isVisible
 * True only when the user can see/interact with the palette; hidden prerenders
 * and pending reveals are not visible.
 *
 * @property {() => boolean} hasPendingReveal
 * True while the overlay has a reveal closure waiting to run.
 *
 * @property {(reveal: Function | null) => Function | null} setPendingReveal
 * Store the reveal closure for the currently hidden overlay.
 *
 * @property {(expected?: Function | null) => boolean} clearPendingReveal
 * Clear the reveal closure. If `expected` is provided, clear only if it is
 * still the current closure; returns false for stale closures.
 *
 * @property {() => boolean} runPendingReveal
 * Invoke the current reveal closure if one exists.
 *
 * @property {() => number} currentInstance
 * Return the live popup instance id used to reject stale POPUP_READY and
 * REVEAL_PALETTE messages.
 *
 * @property {() => number} nextInstance
 * Increment and return the live popup instance id for a cold overlay create.
 *
 * @property {(inst?: number | null) => boolean} matchesInstance
 * True when `inst` is absent or matches the live popup instance id.
 */

(function (scope) {
  function call(impl, name, args) {
    const fn = impl && impl[name];
    if (typeof fn !== "function") return undefined;
    return fn.apply(null, args || []);
  }

  function createOverlayController(impl) {
    let popupInstance = 0;
    let pendingReveal = null;

    function nextInstance() {
      popupInstance++;
      return popupInstance;
    }

    function currentInstance() {
      return popupInstance;
    }

    function matchesInstance(inst) {
      return typeof inst !== "number" || inst === popupInstance;
    }

    function setPendingReveal(reveal) {
      pendingReveal = typeof reveal === "function" ? reveal : null;
      return pendingReveal;
    }

    function clearPendingReveal(expected) {
      if (typeof expected === "function" && pendingReveal !== expected) return false;
      pendingReveal = null;
      return true;
    }

    function hasPendingReveal() {
      return typeof pendingReveal === "function";
    }

    function runPendingReveal() {
      const reveal = pendingReveal;
      if (typeof reveal !== "function") return false;
      reveal();
      return true;
    }

    return {
      create(view, params) { return call(impl, "create", [view, params]); },
      rearm(view, params) { return call(impl, "rearm", [view, params]); },
      destroy(opts) { return call(impl, "destroy", [opts]); },
      reveal() { return call(impl, "reveal", []); },
      forceReveal() { return call(impl, "forceReveal", []); },
      morphTo(view, params) { return call(impl, "morphTo", [view, params]); },
      isVisible() { return !!call(impl, "isVisible", []); },
      isOpen() { return !!call(impl, "isOpen", []); },
      hasPendingReveal,
      setPendingReveal,
      clearPendingReveal,
      runPendingReveal,
      nextInstance,
      currentInstance,
      matchesInstance,
    };
  }

  scope.createOverlayController = createOverlayController;
})(this);
