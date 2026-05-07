"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compareByRecentDesc,
  compareByRecentAsc,
  compareByAgeAsc,
  compareByAgeDesc,
  compareInactiveBottom,
  compareByDomainAlpha,
  makeCompareByDomainPop,
  makeCompareByVisits,
  groupDuplicatesFirst,
  buildDomainCounts,
} = require("../lib/tab-sort.js");

const tab = (overrides = {}) => Object.assign({
  id: 1,
  url: "https://a.example/",
  lastAccessed: 0,
  discarded: false,
}, overrides);

test("compareByRecentDesc orders newest first", () => {
  const tabs = [
    tab({ id: 1, lastAccessed: 100 }),
    tab({ id: 2, lastAccessed: 300 }),
    tab({ id: 3, lastAccessed: 200 }),
  ];
  tabs.sort(compareByRecentDesc);
  assert.deepEqual(tabs.map((t) => t.id), [2, 3, 1]);
});

test("compareByRecentAsc orders oldest first", () => {
  const tabs = [
    tab({ id: 1, lastAccessed: 100 }),
    tab({ id: 2, lastAccessed: 300 }),
    tab({ id: 3, lastAccessed: 200 }),
  ];
  tabs.sort(compareByRecentAsc);
  assert.deepEqual(tabs.map((t) => t.id), [1, 3, 2]);
});

test("compareByAgeAsc / Desc use tab id", () => {
  const tabs = [tab({ id: 30 }), tab({ id: 10 }), tab({ id: 20 })];
  tabs.sort(compareByAgeAsc);
  assert.deepEqual(tabs.map((t) => t.id), [10, 20, 30]);
  tabs.sort(compareByAgeDesc);
  assert.deepEqual(tabs.map((t) => t.id), [30, 20, 10]);
});

test("compareInactiveBottom sinks discarded tabs (stable for equal)", () => {
  const tabs = [
    tab({ id: 1, discarded: false }),
    tab({ id: 2, discarded: true }),
    tab({ id: 3, discarded: false }),
    tab({ id: 4, discarded: true }),
  ];
  tabs.sort(compareInactiveBottom);
  // Stable: 1 and 3 retain order; 2 and 4 retain order; discarded last.
  assert.deepEqual(tabs.map((t) => t.id), [1, 3, 2, 4]);
});

test("compareByDomainAlpha groups by domain, ties by recent-desc", () => {
  const tabs = [
    tab({ id: 1, url: "https://b.example/x", lastAccessed: 100 }),
    tab({ id: 2, url: "https://a.example/y", lastAccessed: 50 }),
    tab({ id: 3, url: "https://a.example/z", lastAccessed: 200 }),
    tab({ id: 4, url: "https://b.example/w", lastAccessed: 300 }),
  ];
  tabs.sort(compareByDomainAlpha);
  // a.example block (id 3 newer than 2), then b.example block (4 newer than 1)
  assert.deepEqual(tabs.map((t) => t.id), [3, 2, 4, 1]);
});

test("compareByDomainAlpha treats malformed URLs as empty domain", () => {
  const tabs = [
    tab({ id: 1, url: "https://b.example/" }),
    tab({ id: 2, url: "not a url" }),
    tab({ id: 3, url: "https://a.example/" }),
  ];
  tabs.sort(compareByDomainAlpha);
  // Empty domain sorts first (localeCompare("", "anything") < 0)
  assert.equal(tabs[0].id, 2);
});

test("buildDomainCounts + makeCompareByDomainPop", () => {
  const tabs = [
    tab({ id: 1, url: "https://a.example/" }),
    tab({ id: 2, url: "https://b.example/" }),
    tab({ id: 3, url: "https://a.example/" }),
    tab({ id: 4, url: "https://a.example/" }),
    tab({ id: 5, url: "https://b.example/" }),
  ];
  const counts = buildDomainCounts(tabs);
  assert.deepEqual(counts, { "a.example": 3, "b.example": 2 });
  const cmp = makeCompareByDomainPop(counts);
  tabs.sort(cmp);
  // a.example (3) before b.example (2)
  assert.deepEqual(tabs.slice(0, 3).map((t) => t.url), [
    "https://a.example/",
    "https://a.example/",
    "https://a.example/",
  ]);
});

test("makeCompareByVisits orders by visit count desc", () => {
  const tabs = [
    tab({ id: 1, url: "https://a/" }),
    tab({ id: 2, url: "https://b/" }),
    tab({ id: 3, url: "https://c/" }),
  ];
  const visits = { "https://a/": 5, "https://b/": 100, "https://c/": 0 };
  tabs.sort(makeCompareByVisits(visits));
  assert.deepEqual(tabs.map((t) => t.id), [2, 1, 3]);
});

test("groupDuplicatesFirst clusters dups (sorted by URL), then non-dups in order", () => {
  const tabs = [
    tab({ id: 1, url: "https://unique-a/" }),
    tab({ id: 2, url: "https://dup-z/" }),
    tab({ id: 3, url: "https://dup-a/" }),
    tab({ id: 4, url: "https://unique-b/" }),
    tab({ id: 5, url: "https://dup-z/" }),
    tab({ id: 6, url: "https://dup-a/" }),
  ];
  const result = groupDuplicatesFirst(tabs);
  // dups first: dup-a (a < z) then dup-z; non-dups in original order
  assert.deepEqual(result.map((t) => t.id), [3, 6, 2, 5, 1, 4]);
});

test("groupDuplicatesFirst returns a new array (does not mutate input)", () => {
  const tabs = [tab({ id: 1, url: "x" }), tab({ id: 2, url: "x" })];
  const original = tabs.slice();
  groupDuplicatesFirst(tabs);
  assert.deepEqual(tabs, original);
});
