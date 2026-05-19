"use strict";

// Pure tab-sort comparators and helpers, extracted so they can be unit
// tested without a browser context. Loaded by background.js via the
// "background.scripts" array in manifest.json — the comparators bind to
// `this` (script-global = self in the background context). The Node test
// shim at the bottom re-exports them so `require("./lib/tab-sort.js")`
// works in `node --test`.
//
// Each comparator is a `(a, b) => number` that defines a total order over
// tab objects shaped like browser.tabs.Tab (with `lastAccessed`, `id`,
// `url`, `discarded` fields).
//
// Higher-level "sort by X" wrappers that need precomputed maps
// (domain popularity, visit counts, duplicate counts) take the precomputed
// data as a parameter so the function stays pure.

(function () {
  function safeDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return "";
    }
  }

  // Most-recently-accessed first.
  this.compareByRecentDesc = (a, b) => b.lastAccessed - a.lastAccessed;

  // Oldest-accessed first.
  this.compareByRecentAsc = (a, b) => a.lastAccessed - b.lastAccessed;

  // By tab age (id is monotonically increasing in browser.tabs).
  this.compareByAgeAsc  = (a, b) => a.id - b.id;
  this.compareByAgeDesc = (a, b) => b.id - a.id;

  // Discarded tabs sink to the bottom; among non-discarded and among
  // discarded, original order is preserved (stable sort guarantee).
  this.compareInactiveBottom = (a, b) =>
    (a.discarded ? 1 : 0) - (b.discarded ? 1 : 0);

  // Group by domain alphabetically; within a domain, most recently
  // accessed first.
  this.compareByDomainAlpha = (a, b) =>
    safeDomain(a.url).localeCompare(safeDomain(b.url)) ||
    b.lastAccessed - a.lastAccessed;

  // Build a comparator that sorts by domain popularity (descending count),
  // ties broken by recent-access. domainCounts: { [domain]: number }.
  this.makeCompareByDomainPop = (domainCounts) => (a, b) => {
    const aCount = domainCounts[safeDomain(a.url)] || 0;
    const bCount = domainCounts[safeDomain(b.url)] || 0;
    return (bCount - aCount) || (b.lastAccessed - a.lastAccessed);
  };

  // Build a comparator that sorts by visit count (descending).
  // visitCounts: { [url]: number }.
  this.makeCompareByVisits = (visitCounts) => (a, b) =>
    (visitCounts[b.url] || 0) - (visitCounts[a.url] || 0);

  // Re-order so duplicate-URL tabs cluster at the front (sorted by URL),
  // followed by single-URL tabs in their original order. Pure and returns
  // a new array — does not mutate input.
  this.groupDuplicatesFirst = (tabs) => {
    const urlCount = {};
    for (const t of tabs) urlCount[t.url] = (urlCount[t.url] || 0) + 1;
    const dups = [];
    const nonDups = [];
    for (const t of tabs) {
      if (urlCount[t.url] > 1) dups.push(t);
      else nonDups.push(t);
    }
    dups.sort((a, b) => a.url.localeCompare(b.url));
    return dups.concat(nonDups);
  };

  // Build the domain-count map used by makeCompareByDomainPop.
  this.buildDomainCounts = (tabs) => {
    const counts = {};
    for (const t of tabs) {
      const d = safeDomain(t.url);
      counts[d] = (counts[d] || 0) + 1;
    }
    return counts;
  };
}).call(this);

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    compareByRecentDesc: this.compareByRecentDesc,
    compareByRecentAsc: this.compareByRecentAsc,
    compareByAgeAsc: this.compareByAgeAsc,
    compareByAgeDesc: this.compareByAgeDesc,
    compareInactiveBottom: this.compareInactiveBottom,
    compareByDomainAlpha: this.compareByDomainAlpha,
    makeCompareByDomainPop: this.makeCompareByDomainPop,
    makeCompareByVisits: this.makeCompareByVisits,
    groupDuplicatesFirst: this.groupDuplicatesFirst,
    buildDomainCounts: this.buildDomainCounts,
  };
}
