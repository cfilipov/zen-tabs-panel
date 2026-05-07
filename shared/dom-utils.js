"use strict";

// DOM and string helpers used by content contexts (popup, options, welcome).
//
// Loaded as <script src="../shared/dom-utils.js"> from each HTML page,
// before the page-specific script.
//
// Pure helpers also export themselves under module.exports for node:test
// (the export is no-op in a browser; `module` is undefined there).

// Escape arbitrary text for safe insertion as HTML element content.
// Uses the DOM's own text-node escaping — the safest pattern.
this.escapeHtml = function (str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
};

// Escape arbitrary text for safe insertion inside an HTML attribute value
// (e.g. `<img src="${escapeAttr(url)}">`). Note: callers must wrap in
// double quotes — single quotes alone are not enough.
this.escapeAttr = function (str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

// Unwrap moz-remote-image:// favicons (Firefox proxies remote favicons
// through this scheme; the real URL is in the `url` query param) and
// reject chrome:// favicons that won't load in content contexts.
//
// Returns "" when the favicon should not be displayed at all.
this.extractFavicon = function (rawUrl) {
  if (!rawUrl) return "";
  let url = rawUrl;
  if (url.startsWith("moz-remote-image://")) {
    try {
      url = new URL(url).searchParams.get("url") || "";
    } catch (e) {
      return "";
    }
  }
  if (!url || url.startsWith("chrome://")) return "";
  return url;
};

// Hostname of `url`, or "" if `url` is malformed.
this.extractDomain = function (url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
};

// Node test shim — pure string helpers run anywhere. `extractFavicon` and
// `extractDomain` rely on the URL constructor (built into Node) so they're
// fine to test directly.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    escapeAttr: this.escapeAttr,
    extractFavicon: this.extractFavicon,
    extractDomain: this.extractDomain,
  };
}
