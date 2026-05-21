"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { escapeAttr, extractFavicon, extractDomain } = require("../src/shared/dom-utils.js");
const {
  isDuplicateNavigationUrl,
  isSameMainFrameNavigationUrl,
} = require("../src/shared/navigation-url.js");

test("escapeAttr escapes the five HTML-attribute hazards", () => {
  assert.equal(escapeAttr(`a&b"c'd<e>f`), "a&amp;b&quot;c&#39;d&lt;e&gt;f");
});

test("escapeAttr coerces non-strings", () => {
  assert.equal(escapeAttr(42), "42");
  assert.equal(escapeAttr(null), "null");
});

test("extractFavicon returns the URL unchanged when valid", () => {
  assert.equal(
    extractFavicon("https://example.com/favicon.ico"),
    "https://example.com/favicon.ico"
  );
});

test("extractFavicon unwraps moz-remote-image://", () => {
  const wrapped = "moz-remote-image://0/?url=" +
    encodeURIComponent("https://cdn.example/icon.png");
  assert.equal(extractFavicon(wrapped), "https://cdn.example/icon.png");
});

test("extractFavicon returns empty for chrome:// favicons", () => {
  assert.equal(extractFavicon("chrome://favicon/foo"), "");
});

test("extractFavicon returns empty for null/undefined/empty", () => {
  assert.equal(extractFavicon(""), "");
  assert.equal(extractFavicon(null), "");
  assert.equal(extractFavicon(undefined), "");
});

test("extractDomain returns hostname for valid URLs", () => {
  assert.equal(extractDomain("https://example.com/foo"), "example.com");
  assert.equal(extractDomain("https://sub.example.com:8080/"), "sub.example.com");
});

test("extractDomain returns empty for malformed input", () => {
  assert.equal(extractDomain("not a url"), "");
  assert.equal(extractDomain(""), "");
});

test("main-frame navigation URL comparison treats reload fragments as same page", () => {
  assert.equal(
    isSameMainFrameNavigationUrl("https://example.com/path?q=1#section", "https://example.com/path?q=1"),
    true
  );
  assert.equal(
    isSameMainFrameNavigationUrl("https://example.com/", "https://example.com"),
    true
  );
});

test("main-frame navigation URL comparison still distinguishes real navigations", () => {
  assert.equal(
    isSameMainFrameNavigationUrl("https://example.com/path?q=1", "https://example.com/path?q=2"),
    false
  );
  assert.equal(
    isSameMainFrameNavigationUrl("https://example.com/path", "https://example.com/other"),
    false
  );
  assert.equal(
    isSameMainFrameNavigationUrl("about:newtab", "https://example.com/"),
    false
  );
});

test("duplicate navigation URL comparison treats directory slash redirects as same target", () => {
  assert.equal(
    isDuplicateNavigationUrl("https://example.com/release-notes", "https://example.com/release-notes/"),
    true
  );
  assert.equal(
    isDuplicateNavigationUrl("https://example.com/release-notes/", "https://example.com/release-notes"),
    true
  );
});

test("duplicate navigation URL comparison does not add slash variants for file-like paths", () => {
  assert.equal(
    isDuplicateNavigationUrl("https://example.com/app.js", "https://example.com/app.js/"),
    false
  );
});
