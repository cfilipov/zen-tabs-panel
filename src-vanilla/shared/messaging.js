"use strict";

// Thin wrappers around browser.runtime.sendMessage for content contexts
// (popup, options, welcome). Background.js calls the experiment API
// directly and does not need these helpers.
//
// Loaded as <script src="../shared/messaging.js"> from each HTML page,
// before the page-specific script.

(function () {
  const ext = typeof browser !== "undefined" ? browser : chrome;

  // Fire-and-forget. The popup's content browser is destroyed during
  // hide-palette, which rejects any pending sendMessage promise — we don't
  // care about that error. Use this for action messages where the caller
  // doesn't read a response.
  this.sendMessage = function (type, payload) {
    const msg = payload ? Object.assign({ type }, payload) : { type };
    return ext.runtime.sendMessage(msg).catch(() => {});
  };

  // Use when you need the response (queries that return data, or callers
  // that need to await completion). Errors propagate so the caller can
  // decide what to do.
  this.sendMessageWithReply = function (type, payload) {
    const msg = payload ? Object.assign({ type }, payload) : { type };
    return ext.runtime.sendMessage(msg);
  };
}).call(this);
