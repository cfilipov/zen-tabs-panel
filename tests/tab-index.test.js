const test = require("node:test");
const assert = require("node:assert/strict");

const { createZenTabIndex } = require("../src/experiment/tab-index.js");

function fakeWindow() {
  const listeners = new Map();
  let mutationHandler = null;
  const tabContainer = {
    addEventListener(name, handler) {
      const handlers = listeners.get(name) || new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
    },
    removeEventListener(name, handler) {
      listeners.get(name)?.delete(handler);
    },
    dispatch(name, event) {
      for (const handler of listeners.get(name) || []) handler(event);
    },
  };
  return {
    gBrowser: {
      tabContainer,
    },
    dispatchMutations(records) {
      mutationHandler?.(records);
    },
    MutationObserver: class {
      constructor(handler) {
        mutationHandler = handler;
      }
      observe() {}
      disconnect() {}
    },
    gZenWorkspaces: {
      addChangeListener() {},
      addChangeListeners() {},
    },
  };
}

function fakeTab(id, url, workspaceId, attrs = {}) {
  return {
    id,
    label: attrs.title || id,
    linkedBrowser: { currentURI: { spec: url } },
    pinned: !!attrs.pinned,
    selected: !!attrs.active,
    lastAccessed: attrs.lastAccessed || 0,
    image: attrs.favIconUrl || "",
    openerTab: null,
    getAttribute(name) {
      if (name === "zen-workspace-id") return workspaceId || "";
      return "";
    },
    hasAttribute(name) {
      return !!attrs[name];
    },
  };
}

function makeIndex(tabs) {
  return makeIndexWithDeps(tabs).index;
}

function makeIndexWithDeps(tabs) {
  const win = fakeWindow();
  const calls = {
    readTabStats: 0,
    readTabValue: 0,
    ensureTabUuid: 0,
  };
  const index = createZenTabIndex({
    getWin: () => win,
    getAllTabElements: () => tabs,
    readTabStats: () => {
      calls.readTabStats++;
      return { focusCount: 0 };
    },
    getExtTabId: (tab) => Number(tab.id.replace(/\D/g, "")) || null,
    unwrapFavicon: (url) => url,
    readTabValue: () => {
      calls.readTabValue++;
      return null;
    },
    ensureTabUuid: (tab) => {
      calls.ensureTabUuid++;
      return `uuid-${tab.id}`;
    },
    recordInterval() {},
  });
  return { index, calls, win };
}

function makeRichIndex(tabs) {
  return createZenTabIndex({
    getWin: fakeWindow,
    getAllTabElements: () => tabs,
    readTabStats: () => ({ focusCount: 0 }),
    getExtTabId: (tab) => Number(tab.id.replace(/\D/g, "")) || null,
    unwrapFavicon: (url) => url,
    readTabValue: () => null,
    ensureTabUuid: (tab) => `uuid-${tab.id}`,
    recordInterval() {},
  });
}

function makeIndexWithStoredValues(tabs, valuesByTabId, statsByTabId = {}) {
  return createZenTabIndex({
    getWin: fakeWindow,
    getAllTabElements: () => tabs,
    readTabStats: (tab) => statsByTabId[tab.id] || null,
    getExtTabId: (tab) => Number(tab.id.replace(/\D/g, "")) || null,
    unwrapFavicon: (url) => url,
    readTabValue: (tab, key) => {
      const values = valuesByTabId[tab.id] || {};
      return values[key] ?? null;
    },
    ensureTabUuid: (tab) => valuesByTabId[tab.id]?.panelTabUuid || `uuid-${tab.id}`,
    recordInterval() {},
  });
}

test("tab index returns duplicate URL groups without about:newtab/about:blank", () => {
  const index = makeIndex([
    fakeTab("tab-1", "https://example.test/a", "ws-1", { title: "A1" }),
    fakeTab("tab-2", "about:newtab", "ws-1"),
    fakeTab("tab-3", "https://example.test/a", "ws-2", { title: "A2" }),
    fakeTab("tab-4", "about:blank", "ws-1"),
    fakeTab("tab-5", "https://other.test/b", "ws-1"),
    fakeTab("tab-6", "https://other.test/b", "ws-1"),
    fakeTab("tab-7", "https://other.test/b", "ws-2"),
  ]);

  const groups = index.getDuplicateGroups({});

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => [group.url, group.tabs.length]), [
    ["https://other.test/b", 3],
    ["https://example.test/a", 2],
  ]);
  assert.equal(groups[0].kind, "duplicate-group");
  assert.equal(groups[0].domain, "other.test");
});

test("tab index duplicate groups respect workspace filters", () => {
  const index = makeIndex([
    fakeTab("tab-1", "https://example.test/a", "ws-1"),
    fakeTab("tab-2", "https://example.test/a", "ws-2"),
    fakeTab("tab-3", "https://other.test/b", "ws-1"),
    fakeTab("tab-4", "https://other.test/b", "ws-1"),
  ]);

  const groups = index.getDuplicateGroups({ workspaceId: "ws-1" });

  assert.deepEqual(groups.map((group) => [group.url, group.tabs.length]), [
    ["https://other.test/b", 2],
  ]);
});

test("tab index can return a singleton duplicate group for prompt previews", () => {
  const index = makeIndex([
    fakeTab("tab-1", "https://example.test/a", "ws-1"),
    fakeTab("tab-2", "https://example.test/b", "ws-1"),
    fakeTab("tab-3", "https://example.test/b", "ws-2"),
  ]);

  const groups = index.getDuplicateGroups({
    url: "https://example.test/a",
    includeSingleton: true,
  });

  assert.deepEqual(groups.map((group) => [group.url, group.tabs.length]), [
    ["https://example.test/a", 1],
  ]);
});

test("tab index returns active rows and requested DOM-id rows without a full transfer", () => {
  const index = makeIndex([
    fakeTab("tab-1", "https://example.test/a", "ws-1"),
    fakeTab("tab-2", "https://example.test/b", "ws-1", { active: true }),
    fakeTab("tab-3", "https://example.test/c", "ws-2"),
  ]);

  assert.equal(index.getActiveRow().domId, "tab-2");
  assert.deepEqual(index.getRowsByDomIds(["tab-3", "missing", "tab-1"]).map((row) => row.domId), [
    "tab-3",
    "tab-1",
  ]);
});

test("tab index windows stay bounded for large tab sets", () => {
  const tabs = Array.from({ length: 3000 }, (_, i) =>
    fakeTab(`tab-${i + 1}`, `https://example.test/${i + 1}`, i % 2 ? "ws-1" : "ws-2", {
      lastAccessed: i,
    })
  );
  const index = makeIndex(tabs);

  const summary = index.getSummary("last-visited", {});
  const win = index.getWindow("last-visited", 2500, 1000, {});

  assert.equal(summary.total, 3000);
  assert.equal(win.offset, 2500);
  assert.equal(win.limit, 200);
  assert.equal(win.total, 3000);
  assert.equal(win.rows.length, 200);
  assert.deepEqual(Object.keys(win.rows[0]).sort(), [
    "active",
    "domId",
    "domain",
    "essential",
    "favIconUrl",
    "focusCount",
    "index",
    "pending",
    "pinned",
    "title",
    "workspaceId",
  ]);
});

test("tab index payloads stay bounded for 10000-tab sessions", () => {
  const tabs = Array.from({ length: 10000 }, (_, i) =>
    fakeTab(`tab-${i + 1}`, `https://site-${i % 500}.test/path/${i + 1}`, `ws-${i % 4}`, {
      title: `Tab ${i + 1}`,
      lastAccessed: i,
    })
  );
  const index = makeRichIndex(tabs);

  const summary = index.getSummary("last-visited", {});
  const win = index.getWindow("last-visited", 2500, 1000, {});

  assert.equal(summary.total, 10000);
  assert.equal(win.offset, 2500);
  assert.equal(win.limit, 200);
  assert.equal(win.rows.length, 200);
  assert.ok(JSON.stringify(summary).length < 200);
  assert.ok(JSON.stringify(win).length < 50000);
});

test("tab index windows include chrome-owned row intents", () => {
  const index = makeIndex([
    fakeTab("tab-1", "https://example.test/a", "ws-1", { lastAccessed: 3 }),
    fakeTab("tab-2", "https://example.test/b", "ws-1", { lastAccessed: 2 }),
  ]);

  const tabs = index.getWindow("last-visited", 0, 10, {});
  assert.deepEqual(tabs.model.rowIntents, [
    { rowId: "tab-1", index: 0, chordKey: "1", action: "activate-tab" },
    { rowId: "tab-2", index: 1, chordKey: "2", action: "activate-tab" },
  ]);

  const domains = index.getWindow("domains", 0, 10, {});
  assert.deepEqual(domains.model.rowIntents[0], {
    rowId: "example.test",
    index: 0,
    chordKey: "1",
    action: "open-domain-tabs",
  });
});

test("domain windows use lightweight tab reads for large tab sets", () => {
  const tabs = Array.from({ length: 3000 }, (_, i) =>
    fakeTab(`tab-${i + 1}`, `https://site-${i % 100}.test/${i + 1}`, i % 2 ? "ws-1" : "ws-2", {
      lastAccessed: i,
    })
  );
  const { index, calls } = makeIndexWithDeps(tabs);

  const domains = index.getWindow("domains", 0, 10, {});
  const tabsForDomain = index.getWindow("domain-tabs", 0, 10, { domain: domains.rows[0].domain });

  assert.equal(domains.rows.length, 10);
  assert.equal(tabsForDomain.rows.length, 10);
  assert.equal(calls.ensureTabUuid, 0);
  assert.equal(calls.readTabStats, 0);
  assert.equal(calls.readTabValue, 0);
});

test("tab index updates changed tab rows incrementally after the first build", () => {
  const tabs = [
    fakeTab("tab-1", "https://one.test", "ws-1", { title: "One", lastAccessed: 10 }),
    fakeTab("tab-2", "https://two.test", "ws-1", { title: "Two", lastAccessed: 20 }),
    fakeTab("tab-3", "https://three.test", "ws-1", { title: "Three", lastAccessed: 30 }),
  ];
  const { index, calls, win } = makeIndexWithDeps(tabs);

  index.getWindow("last-visited", 0, 10, {});
  assert.equal(calls.ensureTabUuid, 3);

  tabs[1].label = "Two updated";
  win.gBrowser.tabContainer.dispatch("TabAttrModified", { target: tabs[1] });

  assert.equal(index.getRowTarget("tab-2").title, "Two updated");
  assert.equal(calls.ensureTabUuid, 4);
  assert.equal(calls.readTabStats, 4);
});

test("tab index profiles large-session incremental changes without a full rebuild", () => {
  const tabs = Array.from({ length: 3000 }, (_, i) =>
    fakeTab(`tab-${i + 1}`, `https://site-${i % 100}.test/${i + 1}`, `ws-${i % 3}`, {
      title: `Tab ${i + 1}`,
      lastAccessed: i,
    })
  );
  const { index, calls, win } = makeIndexWithDeps(tabs);

  index.getWindow("last-visited", 0, 20, {});
  assert.equal(calls.ensureTabUuid, 3000);
  assert.deepEqual(
    {
      rebuildCount: index.getDebugStats().rebuildCount,
      dirtyFallbackCount: index.getDebugStats().dirtyFallbackCount,
    },
    { rebuildCount: 1, dirtyFallbackCount: 0 }
  );

  tabs[1499].label = "Updated tab";
  win.gBrowser.tabContainer.dispatch("TabAttrModified", { target: tabs[1499] });

  assert.equal(index.getRowTarget("tab-1500").title, "Updated tab");
  assert.equal(calls.ensureTabUuid, 3001);
  assert.equal(index.getDebugStats().rebuildCount, 1);
  assert.equal(index.getDebugStats().incrementalUpdateCount, 1);
  assert.equal(index.getDebugStats().dirtyFallbackCount, 0);
});

test("tab index ignores unrelated mutation records instead of forcing a rebuild", () => {
  const tabs = [
    fakeTab("tab-1", "https://one.test", "ws-1", { title: "One", lastAccessed: 10 }),
    fakeTab("tab-2", "https://two.test", "ws-1", { title: "Two", lastAccessed: 20 }),
  ];
  const { index, calls, win } = makeIndexWithDeps(tabs);

  index.getWindow("last-visited", 0, 10, {});
  win.dispatchMutations([{ target: { id: "not-a-tab", parentNode: null } }]);

  assert.equal(index.getDebugStats().dirty, false);
  assert.equal(index.getDebugStats().dirtyFallbackCount, 0);
  assert.equal(index.getDebugStats().rebuildCount, 1);
  assert.equal(calls.ensureTabUuid, 2);
});

test("tab index reindexes cached rows incrementally after close and move", () => {
  const tabs = [
    fakeTab("tab-1", "https://one.test", "ws-1", { title: "One", lastAccessed: 10 }),
    fakeTab("tab-2", "https://two.test", "ws-1", { title: "Two", lastAccessed: 20 }),
    fakeTab("tab-3", "https://three.test", "ws-1", { title: "Three", lastAccessed: 30 }),
  ];
  const { index, calls, win } = makeIndexWithDeps(tabs);

  index.getWindow("last-visited", 0, 10, {});
  assert.equal(calls.ensureTabUuid, 3);

  const closed = tabs.shift();
  win.gBrowser.tabContainer.dispatch("TabClose", { target: closed });
  assert.deepEqual(index.getRowsByDomIds(["tab-2", "tab-3"]).map((row) => [row.domId, row.index]), [
    ["tab-2", 0],
    ["tab-3", 1],
  ]);
  assert.equal(calls.ensureTabUuid, 3);

  tabs.reverse();
  win.gBrowser.tabContainer.dispatch("TabMove", { target: tabs[0] });
  assert.deepEqual(index.getRowsByDomIds(["tab-3", "tab-2"]).map((row) => [row.domId, row.index]), [
    ["tab-3", 0],
    ["tab-2", 1],
  ]);
  assert.equal(calls.ensureTabUuid, 4);
});

test("tab index hides new-tab pages from recents and action previews", () => {
  const index = makeIndex([
    fakeTab("tab-1", "https://active.test", "ws-1", { active: true, lastAccessed: 100 }),
    fakeTab("tab-2", "about:newtab", "ws-1", { title: "New Tab", lastAccessed: 900 }),
    fakeTab("tab-3", "about:blank", "ws-1", { title: "Blank", lastAccessed: 800 }),
    fakeTab("tab-4", "about:home", "ws-1", { title: "Home", lastAccessed: 700 }),
    fakeTab("tab-5", "https://unread.test", "ws-1", { lastAccessed: 600, unread: true }),
    fakeTab("tab-6", "https://previous.test", "ws-1", { lastAccessed: 500 }),
  ]);

  const recents = index.getWindow("last-visited", 0, 20, {});
  assert.deepEqual(recents.rows.map((row) => row.domId), ["tab-6"]);

  const snapshot = index.getActionsSnapshot();
  assert.equal(snapshot.previews["go-to-previous-tab"].title, "tab-6");
  assert.equal(snapshot.unvisitedTabCount, 1);
  assert.equal(snapshot.domainCount, 3);
});

test("tab index uses persisted parent UUIDs when openerTab is gone after restart", () => {
  const tabs = [
    fakeTab("tab-1", "https://parent.test", "ws-1", { title: "Parent" }),
    fakeTab("tab-2", "https://child-a.test", "ws-1", { title: "Child A", active: true }),
    fakeTab("tab-3", "https://child-b.test", "ws-1", { title: "Child B" }),
    fakeTab("tab-4", "https://unrelated.test", "ws-1", { title: "Unrelated" }),
  ];
  const index = makeIndexWithStoredValues(tabs, {
    "tab-1": { panelTabUuid: "parent-uuid" },
    "tab-2": { panelTabUuid: "child-a-uuid", panelParentUuid: "parent-uuid" },
    "tab-3": { panelTabUuid: "child-b-uuid", panelParentUuid: "parent-uuid" },
    "tab-4": { panelTabUuid: "unrelated-uuid" },
  });

  assert.deepEqual(index.getWindow("parent-tabs", 0, 20, {}).rows.map((row) => [row.domId, row.childCount]), [["tab-1", 2]]);
  assert.deepEqual(index.getWindow("child-tabs", 0, 20, { parentDomId: "tab-1" }).rows.map((row) => row.domId), [
    "tab-2",
    "tab-3",
  ]);
  assert.deepEqual(index.getWindow("sibling-tabs", 0, 20, {}).rows.map((row) => row.domId), ["tab-3"]);

  const snapshot = index.getActionsSnapshot();
  assert.equal(snapshot.currentTabHasParent, true);
  assert.equal(snapshot.parentTabCount, 1);
  assert.equal(snapshot.siblingTabCount, 1);
  assert.equal(snapshot.previews["go-to-parent-tab"].title, "Parent");
});

test("tab index carries persisted focus stats into most-visited rows", () => {
  const index = makeIndexWithStoredValues(
    [
      fakeTab("tab-1", "https://low.test", "ws-1"),
      fakeTab("tab-2", "https://high.test", "ws-1"),
      fakeTab("tab-3", "https://none.test", "ws-1"),
    ],
    {},
    {
      "tab-1": { v: 1, focusCount: 2, focusDurationSeconds: 10, createdAt: 100, openerType: "manual" },
      "tab-2": { v: 1, focusCount: 50, focusDurationSeconds: 20, createdAt: 200, openerType: "link" },
    }
  );

  const rows = index.getWindow("most-visited", 0, 20, {}).rows;

  assert.deepEqual(rows.map((row) => [row.domId, row.focusCount]), [
    ["tab-2", 50],
    ["tab-1", 2],
    ["tab-3", 0],
  ]);
});

test("tab index unwraps proxied data favicons and keeps large data favicons", () => {
  const wrapped = "moz-remote-image://?url=" + encodeURIComponent("data:image/svg+xml;base64,PHN2Zy8+");
  const largeDataIcon = `data:image/svg+xml;base64,${"a".repeat(4096)}`;
  const tooLargeDataIcon = `data:image/svg+xml;base64,${"a".repeat(70000)}`;
  const index = makeIndex([
    fakeTab("tab-1", "https://wrapped.test/a", "ws-1", {
      favIconUrl: wrapped,
      lastAccessed: 100,
    }),
    fakeTab("tab-2", "https://large.test/b", "ws-1", {
      favIconUrl: largeDataIcon,
      lastAccessed: 90,
    }),
    fakeTab("tab-3", "https://huge.test/c", "ws-1", {
      favIconUrl: tooLargeDataIcon,
      lastAccessed: 80,
    }),
    fakeTab("tab-4", "https://chrome.test/d", "ws-1", {
      favIconUrl: "chrome://mozapps/skin/extensions/extension.svg",
      lastAccessed: 70,
    }),
  ]);

  const win = index.getWindow("last-visited", 0, 10, {});
  const rows = win.rows;

  assert.equal(rows[0].favIconUrl, "data:image/svg+xml;base64,PHN2Zy8+");
  assert.equal(rows[1].favIconUrl, "ztt-favicon:f1");
  assert.equal(win.favicons.f1, largeDataIcon);
  assert.equal(rows[2].favIconUrl, "ztt-favicon:f2");
  assert.equal(win.favicons.f2, tooLargeDataIcon);
  assert.equal(rows[3].favIconUrl, "");
});

test("tab index deduplicates large data favicons in window payloads", () => {
  const largeDataIcon = `data:image/png;base64,${"b".repeat(4096)}`;
  const index = makeIndex([
    fakeTab("tab-1", "https://a.test", "ws-1", { favIconUrl: largeDataIcon, lastAccessed: 100 }),
    fakeTab("tab-2", "https://b.test", "ws-1", { favIconUrl: largeDataIcon, lastAccessed: 90 }),
  ]);

  const win = index.getWindow("last-visited", 0, 10, {});

  assert.equal(win.rows[0].favIconUrl, "ztt-favicon:f1");
  assert.equal(win.rows[1].favIconUrl, "ztt-favicon:f1");
  assert.deepEqual(Object.keys(win.favicons), ["f1"]);
  assert.equal(win.favicons.f1, largeDataIcon);
});

test("tab index returns only stale close targets for auto-close sweeps", () => {
  const index = makeIndex([
    fakeTab("tab-1", "https://example.test/a", "ws-1", { lastAccessed: 100 }),
    fakeTab("tab-2", "https://example.test/b", "ws-1", { lastAccessed: 100, pinned: true }),
    fakeTab("tab-3", "https://example.test/c", "ws-1", { lastAccessed: 100, active: true }),
    fakeTab("tab-4", "https://example.test/d", "ws-1", { lastAccessed: 5000 }),
  ]);

  assert.deepEqual(index.getAutoCloseCandidates(1000).map((row) => row.domId), ["tab-1"]);
});
