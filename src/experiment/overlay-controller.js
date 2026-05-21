"use strict";

// Adapter boundary for a future ChordSession-owned overlay lifecycle.
//
// ChordSession should decide *when* the palette overlay is created, rearmed,
// revealed, swapped, or destroyed. The implementation should stay here in
// chrome/XUL land because it touches DOM nodes, XUL <browser> elements, panel
// sizing, animation settings, hosted extension popups, and focus.
//
// The controller owns overlay-private state: popup instance gating,
// pending/explicit reveal bookkeeping, morph generations, current palette
// view params, navigation stack, and resize diagnostics. api.js still owns
// the concrete chrome DOM/XUL implementation behind the adapter.

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
 * @property {(view?: string | null) => number} beginExplicitReveal
 * Start a direct-open reveal attempt and return its token.
 *
 * @property {() => number} cancelExplicitReveal
 * Invalidate any pending direct-open reveal attempt.
 *
 * @property {() => Object} getExplicitRevealState
 * Return debug state for the direct-open reveal scheduler.
 *
 * @property {() => number} nextMorphGeneration
 * Increment and return the generation token for an overlay browser morph.
 *
 * @property {(generation: number) => boolean} isCurrentMorphGeneration
 * True when an async morph callback still belongs to the latest morph.
 *
 * @property {() => void} resetResizeState
 * Reset per-view dynamic sizing state for a newly armed/rearmed overlay.
 *
 * @property {(view?: string | null, params?: Object | null) => void} resetViewState
 * Reset navigation and resize state for a fresh overlay view.
 *
 * @property {() => Object} getViewState
 * Return current view, params, nav stack, and resize diagnostics.
 *
 * @property {() => Object} getDebugState
 * Return all controller-owned state used by the chord inspector.
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
    let explicitRevealToken = 0;
    let explicitRevealView = null;
    let explicitRevealScheduledToken = 0;
    let morphGeneration = 0;
    let dynamicSidebarWidth = 0;
    let measuredResizeView = null;
    let navStack = [];
    let currentViewName = null;
    let currentViewParams = {};

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

    function beginExplicitReveal(view) {
      explicitRevealToken++;
      explicitRevealView = view || "actions";
      explicitRevealScheduledToken = 0;
      return explicitRevealToken;
    }

    function cancelExplicitReveal() {
      explicitRevealToken++;
      explicitRevealView = null;
      explicitRevealScheduledToken = 0;
      return explicitRevealToken;
    }

    function getExplicitRevealView() {
      return explicitRevealView;
    }

    function isExplicitRevealCurrent(token) {
      return token === explicitRevealToken;
    }

    function isExplicitRevealScheduled(token) {
      return token === explicitRevealScheduledToken;
    }

    function markExplicitRevealScheduled(token) {
      if (explicitRevealScheduledToken === token) return false;
      explicitRevealScheduledToken = token;
      return true;
    }

    function clearExplicitReveal() {
      explicitRevealView = null;
      explicitRevealScheduledToken = 0;
    }

    function getExplicitRevealState() {
      return {
        explicitRevealToken,
        explicitRevealView,
        explicitRevealScheduledToken,
      };
    }

    function nextMorphGeneration() {
      morphGeneration++;
      return morphGeneration;
    }

    function isCurrentMorphGeneration(generation) {
      return generation === morphGeneration;
    }

    function resetResizeState() {
      dynamicSidebarWidth = 0;
      measuredResizeView = null;
    }

    function setDynamicSidebarWidth(width) {
      dynamicSidebarWidth = Math.max(0, Math.ceil(Number(width) || 0));
      return dynamicSidebarWidth;
    }

    function getDynamicSidebarWidth() {
      return dynamicSidebarWidth;
    }

    function setMeasuredResizeView(view) {
      measuredResizeView = view || null;
      return measuredResizeView;
    }

    function getMeasuredResizeView() {
      return measuredResizeView;
    }

    function clonePlain(value) {
      if (value == null) return value;
      try { return JSON.parse(JSON.stringify(value)); }
      catch (e) { return value; }
    }

    function normalizeView(view) {
      return view || "actions";
    }

    function resetViewState(view, params) {
      navStack = [];
      currentViewName = normalizeView(view);
      currentViewParams = params || {};
      resetResizeState();
    }

    function clearViewState() {
      navStack = [];
      currentViewName = null;
      currentViewParams = {};
      resetResizeState();
    }

    function getCurrentView() {
      return currentViewName;
    }

    function getCurrentParams() {
      return currentViewParams || {};
    }

    function setCurrentView(view, params) {
      currentViewName = normalizeView(view);
      if (arguments.length > 1) currentViewParams = params || {};
      return currentViewName;
    }

    function pushNavigation(view, params) {
      navStack.push({ view: view || currentViewName, params: params || {} });
    }

    function pushCurrentNavigation() {
      pushNavigation(currentViewName, currentViewParams || {});
    }

    function clearNavigation() {
      navStack = [];
    }

    function setNavigationStack(stack) {
      navStack = Array.isArray(stack)
        ? stack.map((entry) => ({ view: entry && entry.view || null, params: entry && entry.params || {} }))
        : [];
    }

    function navigationLength() {
      return navStack.length;
    }

    function popNavigation() {
      return navStack.pop() || null;
    }

    function getViewState() {
      return clonePlain({
        currentViewName,
        currentViewParams,
        navStack,
        currentDynamicSidebarWidth: dynamicSidebarWidth,
        currentMeasuredResizeView: measuredResizeView,
      });
    }

    function getDebugState() {
      return clonePlain({
        popupInstance,
        pendingReveal: hasPendingReveal(),
        explicitRevealToken,
        explicitRevealView,
        explicitRevealScheduledToken,
        morphGeneration,
        currentViewName,
        currentViewParams,
        navStack,
        currentDynamicSidebarWidth: dynamicSidebarWidth,
        currentMeasuredResizeView: measuredResizeView,
      });
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
      beginExplicitReveal,
      cancelExplicitReveal,
      getExplicitRevealView,
      isExplicitRevealCurrent,
      isExplicitRevealScheduled,
      markExplicitRevealScheduled,
      clearExplicitReveal,
      getExplicitRevealState,
      nextMorphGeneration,
      isCurrentMorphGeneration,
      resetResizeState,
      setDynamicSidebarWidth,
      getDynamicSidebarWidth,
      setMeasuredResizeView,
      getMeasuredResizeView,
      resetViewState,
      clearViewState,
      getCurrentView,
      getCurrentParams,
      setCurrentView,
      pushNavigation,
      pushCurrentNavigation,
      clearNavigation,
      setNavigationStack,
      navigationLength,
      popNavigation,
      getViewState,
      getDebugState,
      nextInstance,
      currentInstance,
      matchesInstance,
    };
  }

  scope.createOverlayController = createOverlayController;
})(this);
