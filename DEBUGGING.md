# Debugging the Extension

Practical notes for live-debugging this Firefox/Zen WebExtension. Companion to `CLAUDE.md` and `ZEN_INTERNALS.md`.

## Starting Zen with the remote debugger

```bash
/Applications/Zen.app/Contents/MacOS/zen --start-debugger-server 6000
```

This opens a DevTools RDP server on `127.0.0.1:6000` that `tools/firefox-eval.py` connects to. Required prefs (set once in `about:config`):

- `devtools.debugger.remote-enabled` → `true`
- `devtools.chrome.enabled` → `true`

## Live-evaluating JS in chrome scope

```bash
python3 tools/firefox-eval.py 'JS expression here'
```

The expression runs in the parent process — same scope as the built `experiment/api.js` from the active source root. Access the browser window via:

```js
const w = Services.wm.getMostRecentWindow("navigator:browser");
// w.gBrowser, w.gZenWorkspaces, w.document, etc.
```

### Patterns that work

**Wrap multi-statement code in an IIFE that returns a value.** Without it, `const`/`let` declarations make the eval return `undefined`:

```bash
python3 tools/firefox-eval.py '(() => { const w = Services.wm.getMostRecentWindow("navigator:browser"); return w.gBrowser.tabs.length; })()'
```

**Log to the browser console for cross-eval persistence.** Survives across separate eval calls:

```js
Services.console.logStringMessage("[MYTAG] event happened");

// Read back later:
const msgs = Services.console.getMessageArray()
  .filter(m => (m.message || "").includes("[MYTAG]"))
  .map(m => m.message);
```

**Stash debug state on the chrome window** to inspect across calls:

```js
// In one eval:
Services.wm.getMostRecentWindow("navigator:browser").gMyDebug = [];

// Add entries from extension code:
const w = Services.wm.getMostRecentWindow("navigator:browser");
w.gMyDebug.push({ t: Date.now(), event: "..." });

// Read in another eval:
return Services.wm.getMostRecentWindow("navigator:browser").gMyDebug;
```

**Reset console output before a focused test:**

```js
Services.console.reset();
Services.console.logStringMessage("[MARKER] === starting test ===");
```

### Patterns that don't work

- **Async results are awkward.** `tools/firefox-eval.py` may return a DevTools `Promise` grip rather than the awaited value. Sometimes the preview eventually shows a fulfilled value; sometimes you only see `pending`. For reliable probes, start async work, stash the eventual result on the browser window, and poll it:

```bash
python3 tools/firefox-eval.py '(() => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  w.__zttProbe = "pending";
  Promise.resolve()
    .then(async () => {
      // async work here
      w.__zttProbe = { ok: true, value: 123 };
    })
    .catch(e => {
      w.__zttProbe = { ok: false, message: String(e?.message || e), stack: String(e?.stack || e) };
    });
  return "started";
})()'

python3 tools/firefox-eval.py '(() => JSON.stringify(Services.wm.getMostRecentWindow("navigator:browser").__zttProbe, null, 2))()'
```

- **Synthesized DOM events don't trigger WebExtension APIs.** `element.click()` and `dispatchEvent(new MouseEvent(...))` won't fire `browser.browserAction.onClicked`. The OS-level keyboard shortcut for `browser.commands` also can't be reliably synthesized from chrome scope. For end-to-end testing of these triggers, the user has to press them manually.

## Installing the temporary add-on from the debug session

If the extension is not installed, build it and install the generated `dist/`
directory:

```bash
npm run build
```

Then the debug bridge can usually install it temporarily:

```bash
python3 tools/firefox-eval.py '
(async () => {
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
  const file = new FileUtils.File("/Users/cfilipov/Developer/ergozen/dist");
  const addon = await AddonManager.installTemporaryAddon(file);
  return JSON.stringify({
    ok: true,
    id: addon.id,
    name: addon.name,
    version: addon.version,
    isActive: addon.isActive,
    temporarilyInstalled: addon.temporarilyInstalled
  }, null, 2);
})()
'
```

Pass the built extension **directory**, not `manifest.json`. Passing `manifest.json` makes Firefox try to open the manifest as an XPI and fail with `NS_ERROR_FAILURE [nsIZipReader.open]`.

After installation, verify the extension is live:

```bash
python3 tools/firefox-eval.py '(() => {
  const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
  const ext = ExtensionParent.GlobalManager.extensionMap.get("zen-tabs-panel@c13v.com");
  return JSON.stringify(ext && {
    id: ext.id,
    uuid: ext.uuid,
    state: ext.state,
    name: ext.manifest?.name,
    version: ext.manifest?.version,
    backgroundState: ext.backgroundState
  }, null, 2);
})()'
```

## Reloading the extension after code changes

Treat reload behavior as something to prove in the current Zen build. Earlier debugging notes claimed `AddonManager.getAddonByID(...).reload()` does not re-execute `experiment/api.js` for this temporary extension, but later sessions appeared to reload successfully. Do not rely on either memory. Stamp the code you are testing and verify which scopes actually changed.

Suggested reload probe:

1. Add a temporary, clearly searchable stamp to the scope you changed, such as `Services.console.logStringMessage("[ZTP-RELOAD] api stamp 2026-05-14T12:34")` in the active source root's `experiment/api.js`, or assign a debug value on the background/window.
2. Run `AddonManager.reload()`.
3. Use `Services.console.getMessageArray()`, extension state inspection, or a direct API call to prove the new stamp is running.
4. If the stamp does not update, use disable+enable and verify again.

Plain reload:

```bash
python3 tools/firefox-eval.py '
(async () => {
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const a = await AddonManager.getAddonByID("zen-tabs-panel@c13v.com");
  await a.reload();
  return "reloaded";
})()
'
```

Fallback: disable then re-enable.

```bash
python3 tools/firefox-eval.py '
(async () => {
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const a = await AddonManager.getAddonByID("zen-tabs-panel@c13v.com");
  await a.disable();
  await new Promise(r => setTimeout(r, 200));
  await a.enable();
})();
"reloading via disable+enable"
'
```

For changes that touch only the active source root's `background.js` or `popup/`, plain `reload()` is usually enough, but still verify with a stamp when debugging something subtle. For `experiment/api.js` or schema changes, verify every time until the reload behavior has been proven for the current Zen version.

2026-05-14 probe result in the running Zen build: plain `AddonManager.reload()` refreshed all three stamped scopes (`experiment/api.js`, `background.js`, and `popup/popup.js`). Disable+enable also refreshed all three. This does not prove future Zen versions behave the same, but it means plain reload is currently usable when verified with a stamp.

## Inspecting extension state

```js
const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
const ext = ExtensionParent.GlobalManager.extensionMap.get("zen-tabs-panel@c13v.com");
// ext.state — "Startup: Complete" when ready
// ext.backgroundState — "running" when background script is alive
// ext.manifest — parsed manifest.json
// ext.shortcuts — registered keyboard commands
// ext.temporarilyInstalled — true for dev installs
```

## Running WebExtension API probes in the background page

Chrome-scope eval cannot directly call the background page's `browser.*` APIs, but it can inject a one-shot frame script into the background page's hidden browser and receive the result over `messageManager`. This is useful for comparing WebExtension API behavior against chrome DOM truth.

```bash
python3 tools/firefox-eval.py '(() => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
  const ext = ExtensionParent.GlobalManager.extensionMap.get("zen-tabs-panel@c13v.com");
  const bg = Array.from(ext?.views || []).find(v => v.viewType === "background");
  const mm = bg?.xulBrowser?.messageManager;
  if (!mm) return JSON.stringify({ ok: false, error: "no background messageManager" });

  const name = "ZenTabsPanel:BgProbe:" + Date.now();
  w.__zttBgProbe = "pending";
  mm.addMessageListener(name, function handler(msg) {
    try { mm.removeMessageListener(name, handler); } catch (e) {}
    w.__zttBgProbe = msg.data;
  });

  const code = `(() => {
    (async () => {
      const cw = content.wrappedJSObject || content;
      try {
        const tabsQuery = await cw.browser.tabs.query({ currentWindow: true });
        const allTabs = await cw.browser.zenWorkspaces.getAllTabs();
        sendAsyncMessage(${JSON.stringify(name)}, {
          ok: true,
          tabsQueryCount: tabsQuery.length,
          zenAllTabsCount: allTabs.length,
          zenAllTabsBytes: JSON.stringify(allTabs).length
        });
      } catch (e) {
        sendAsyncMessage(${JSON.stringify(name)}, {
          ok: false,
          message: String(e?.message || e),
          stack: String(e?.stack || e)
        });
      }
    })();
  })();`;

  mm.loadFrameScript("data:application/javascript," + encodeURIComponent(code), false);
  return JSON.stringify({ ok: true, started: true, result: "__zttBgProbe" });
})()'

python3 tools/firefox-eval.py '(() => JSON.stringify(Services.wm.getMostRecentWindow("navigator:browser").__zttBgProbe, null, 2))()'
```

In the 2026-05-14 session, this showed `browser.tabs.query({ currentWindow: true })` returning 466 tabs while `browser.zenWorkspaces.getAllTabs()` returned 1041 tabs, confirming that WebExtension tab queries are not authoritative across workspaces.

You can also drive extension APIs from this background frame-script path. Example: `await cw.browser.zenWorkspaces.showPalette()` opens the palette without manually pressing the toolbar button or keyboard shortcut.

## Performance probes

Use chrome-scope probes to separate "native chrome DOM/indexing cost" from "extension IPC + structured clone payload cost."

Lean chrome-side scan:

```bash
python3 tools/firefox-eval.py '(() => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const runs = [];
  let count = 0;
  let serializedBytes = 0;
  for (let i = 0; i < 25; i++) {
    const t0 = w.performance.now();
    const records = Array.from(w.document.querySelectorAll(".tabbrowser-tab")).map((tab, index) => ({
      index,
      id: tab.linkedPanel || tab.getAttribute("linkedpanel") || "",
      label: tab.getAttribute("label") || "",
      workspaceId: tab.getAttribute("zen-workspace-id") || "",
      selected: tab.selected === true,
      pending: tab.hasAttribute("pending"),
      hidden: tab.hidden === true
    }));
    const json = JSON.stringify(records);
    const t1 = w.performance.now();
    runs.push(t1 - t0);
    count = records.length;
    serializedBytes = json.length;
  }
  runs.sort((a, b) => a - b);
  return JSON.stringify({
    count,
    serializedBytes,
    minMs: runs[0],
    p50Ms: runs[Math.floor(runs.length / 2)],
    p95Ms: runs[Math.floor(runs.length * 0.95)],
    avgMs: runs.reduce((a, b) => a + b, 0) / runs.length
  }, null, 2);
})()'
```

Background/API payload probe: use the "Running WebExtension API probes in the background page" pattern above, and include `JSON.stringify(result).length` for any result that crosses extension boundaries. During the Svelte migration, normal summary/window APIs should stay bounded and low-KB even when total tab count is 3000+.

2026-05-14 baseline:

- Chrome-scope compact scan of 1041 tabs: p50 ~1.5ms, p95 ~4.3ms, ~194 KB serialized.
- Background `browser.zenWorkspaces.getAllTabs()` for 1041 tabs: ~59ms and ~8.6 MB serialized.
- Conclusion: chrome-side indexing can be cheap; cloning rich all-tab snapshots through the extension boundary is the UX danger.

## Popup screenshot baselines

For visual baselines, prefer Firefox's privileged snapshot path over macOS
`screencapture`. In this session, `screencapture` failed with display-capture
permissions, while `WindowGlobal.drawSnapshot(...)` worked reliably.

Important capture lessons from 2026-05-14:

- Capture at device-pixel scale (`scale = Math.max(2, devicePixelRatio)`) or text looks fuzzy.
- Force a fresh overlay/browser per view. Warm-popup rearm can produce stale main-menu content or stale dimensions.
- Wait for the popup to report the expected title/current view before snapshotting.
- Use the popup browser's CSS `style.width`/`style.height` as the snapshot rectangle; `getBoundingClientRect()` can be `0x0` during panel scale animations even when the browser has the correct CSS dimensions.
- Verify every generated PNG is not `1x1`, not stale main-menu content, and not clipped/squeezed.

The current baseline set lives in `debug-baselines/2026-05-14/`. These are live
profile references, not naive pixel-perfect goldens for arbitrary future state.
For automated comparison, use deterministic fixture data or mask dynamic regions
such as tab titles, counts, favicons, history, and workspace names.

## Popup live smoke test

After building and reloading the extension, run:

```bash
npm run smoke:popup
```

This uses `tools/firefox-eval.py` against the running debug Zen instance and
drives the extension through the background page plus the popup bridge. It
checks the failure modes that unit tests do not see:

- the chrome overlay browser reaches `popup.html` instead of staying at
  `about:blank`
- the main actions menu renders with page dots and no permanent row selection
- the actions panel returns to the full actions width after warm rearm
- Space flips to page 2 and page 2 is non-empty
- `R` opens Recent through the popup bridge
- direct `Domains` submenu opening renders a bounded list view, and `S`
  remains wired to the list sort path

The smoke sends popup bridge events rather than OS-level key events; it is an
integration check for the extension/popup dispatch path, not a replacement for
manual checks of the configurable browser command shortcut (`Cmd+.` by
default). It leaves the palette hidden when it finishes.

Do not use `tools/firefox-eval.py` to validate chord key delivery by
dispatching DOM `KeyboardEvent`s. Those events are synthetic
(`isTrusted === false`) and the chord engine intentionally ignores them in the
real keydown path. Use `firefox-eval.py` for state inspection and chrome
probes; use actual OS-level key delivery, or manual typing, for end-to-end
leader/chord verification.

2026-05-16 note: current Firefox/Zen can return DevTools `resultID` and the
actual `evaluationResult` in the same RDP packet. `tools/firefox-eval.py` now
checks the whole packet for a concrete result before waiting for a later one;
without that, successful evals can look like hangs.

## Tab-index event probes

For the Svelte migration's experiment-authoritative tab index, verify which chrome events and DOM mutations are reliable before trusting an incremental index.

2026-05-14 controlled probe results:

- Creating a temporary `about:blank` tab fired `TabOpen`.
- Selecting it fired `TabSelect`.
- Moving it fired `TabMove`.
- Removing it fired `TabClose`.
- Label/image/unread/selection changes fired `TabAttrModified`.
- A scoped `MutationObserver` on `.tabbrowser-tab` attributes saw `label`, `image`, `unread`, `selected`, `visuallyselected`, and `zen-workspace-id` changes.
- Workspace switching with `gZenWorkspaces.changeWorkspaceWithID()` fired `TabSelect` for the auto-selected tab in the destination workspace and triggered `gZenWorkspaces.addChangeListeners(...)`.

Indexing implication: use tab-container events for lifecycle/order/selection, `gZenWorkspaces.addChangeListeners` for workspace switches, and a scoped MutationObserver for tab attributes that affect row data. Be careful not to double-count if listening on both `gBrowser.tabContainer` and `document`; the same tab event can be observed twice.

## Frame-script accumulation probes

Use this to inspect delayed frame scripts after reloads:

```bash
python3 tools/firefox-eval.py '(() => {
  const rows = Array.from(Services.mm.getDelayedFrameScripts()).map((u, index) => {
    const s = String(u);
    let decoded = s;
    try { decoded = decodeURIComponent(s); } catch (e) {}
    return {
      index,
      length: s.length,
      gen: decoded.match(/var __GEN = "([^"]+)"/)?.[1] || null,
      extUrl: decoded.match(/loadSubScript\("([^"]+)/)?.[1] || null
    };
  });
  return JSON.stringify({ count: rows.length, rows }, null, 2);
})()'
```

2026-05-14 result: after repeated plain reloads, `Services.mm.getDelayedFrameScripts()` contained exactly one delayed chord frame script, and its generation changed on each reload. No delayed-script accumulation was observed in the current code/current Zen build. Currently-loaded stale frame scripts in existing content processes are still a separate concern; generation filtering remains necessary.

## Capturing keystrokes from chrome scope

A capture-phase `keydown` listener on the chrome window receives keys even when web content has focus, because the chrome window owns the XUL `<browser>` element wrapping the active tab:

```js
const w = Services.wm.getMostRecentWindow("navigator:browser");
const listener = (e) => { /* ... */ };
w.addEventListener("keydown", listener, true);  // capture phase
// remove with the same args
w.removeEventListener("keydown", listener, true);
```

Note: the older `Services.els.addSystemEventListener` API is **not** available on current Firefox/Zen versions — the service exists but the method isn't on it. A plain capture-phase listener is sufficient.

## Keyboard leak probes

The chord engine's content-side default-group blocker can be tested with a page that records keydown events at `window` capture, `document` capture, `document` bubble, and `window` bubble, plus a focused textarea. This catches both character insertion leaks and page-keybinding leaks.

2026-05-14 results:

- `Cmd+.`, `q` from a focused textarea opened the Domains view. The textarea stayed empty. The `q` key reached the page's `window` capture listener, but did not reach `document` capture, `document` bubble, or `window` bubble.
- `Cmd+.`, `p` from a focused textarea fired the previous-tab terminal action. The textarea stayed empty. The `p` key reached the page's `window` capture listener, but did not reach `document` capture, `document` bubble, or `window` bubble.

Interpretation: the default-group blocker stops propagation past the content window, which blocks normal page handlers on document/body/inner nodes and prevents text insertion. A page that registers a `window` capture listener can still observe the chord key before propagation is stopped. Treat that as a known boundary of the current design, not a Svelte migration regression.

Minimal page-side harness:

```html
<textarea id="probe"></textarea>
<script>
  window.__ztpPageKeyLog = [];
  function rec(where, phase, e) {
    window.__ztpPageKeyLog.push({
      where,
      phase,
      key: e.key,
      code: e.code,
      meta: e.metaKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      defaultPrevented: e.defaultPrevented,
      value: document.getElementById("probe").value,
      time: Date.now()
    });
  }
  window.addEventListener("keydown", rec.bind(null, "window", "capture"), true);
  document.addEventListener("keydown", rec.bind(null, "document", "capture"), true);
  document.addEventListener("keydown", rec.bind(null, "document", "bubble"), false);
  window.addEventListener("keydown", rec.bind(null, "window", "bubble"), false);
  addEventListener("load", () => document.getElementById("probe").focus());
</script>
```

## Useful one-liners

```js
// Active tab info
(() => { const w = Services.wm.getMostRecentWindow("navigator:browser"); const t = w.gBrowser.selectedTab; return { id: t.id, label: t.label, url: t.linkedBrowser?.currentURI?.spec, hasParent: !!t.openerTab }; })()

// All tab elements (cross-workspace)
(() => Services.wm.getMostRecentWindow("navigator:browser").document.querySelectorAll(".tabbrowser-tab").length)()

// Overlay state
(() => { const w = Services.wm.getMostRecentWindow("navigator:browser"); const o = w.document.getElementById("zen-tabs-panel-overlay"); return o ? { id: o.id, closing: o.dataset.closing || "no" } : "absent"; })()

// Richer overlay state
(() => { const w = Services.wm.getMostRecentWindow("navigator:browser"); const o = w.document.getElementById("zen-tabs-panel-overlay"); if (!o) return { overlay: false }; const br = o.querySelector("browser"); return { overlay: true, display: w.getComputedStyle(o).display, visibility: w.getComputedStyle(o).visibility, opacity: w.getComputedStyle(o).opacity, src: br?.getAttribute("src") || br?.currentURI?.spec }; })()

// Recent JS errors mentioning the extension
(() => Services.console.getMessageArray().slice(-30).map(m => m.message || String(m)).filter(s => s.toLowerCase().includes("ergozen") || s.toLowerCase().includes("zen-tabs") || s.toLowerCase().includes("error")).slice(-5).join(" || "))()

// Installed ErgoZen extension state
(() => { const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs"); const ext = ExtensionParent.GlobalManager.extensionMap.get("zen-tabs-panel@c13v.com"); return ext && { id: ext.id, uuid: ext.uuid, state: ext.state, backgroundState: ext.backgroundState, version: ext.manifest?.version }; })()
```
