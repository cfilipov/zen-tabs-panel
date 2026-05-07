"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { escapeAttr, extractFavicon, extractDomain } = require("../shared/dom-utils.js");

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
