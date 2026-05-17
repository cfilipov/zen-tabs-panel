const test = require("node:test");
const assert = require("node:assert/strict");

const { createZenTabIndex } = require("../src-svelte/experiment/tab-index.js");

function fakeWindow() {
  return {
    gBrowser: {
      tabContainer: {
        addEventListener() {},
        removeEventListener() {},
      },
    },
    MutationObserver: class {
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
    "id",
    "index",
    "lastAccessed",
    "openerTabDomId",
    "panelParentUuid",
    "panelTabUuid",
    "pending",
    "pinned",
    "splitGroupId",
    "splitView",
    "title",
    "unread",
    "url",
    "workspaceId",
  ]);
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
