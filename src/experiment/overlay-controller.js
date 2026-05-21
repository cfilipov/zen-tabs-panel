"use strict";

// Contract sketch for a future ChordSession-owned overlay lifecycle.
//
// ChordSession should decide *when* the palette overlay is created, rearmed,
// revealed, swapped, or destroyed. The implementation should stay here in
// chrome/XUL land because it touches DOM nodes, XUL <browser> elements, panel
// sizing, animation settings, hosted extension popups, and focus.
//
// This file intentionally exports no runtime implementation yet. It records
// the adapter boundary so future lifecycle moves are explicit instead of
// smuggling DOM closures into ChordSession.

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
 * @property {() => number} currentInstance
 * Return the live popup instance id used to reject stale POPUP_READY and
 * REVEAL_PALETTE messages.
 */

