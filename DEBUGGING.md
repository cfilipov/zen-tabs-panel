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

The expression runs in the parent process — same scope as `experiment/api.js`. Access the browser window via:

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

- **Async results don't await automatically.** The eval returns whatever the JS evaluates to synchronously. For `await` chains, use fire-and-forget (`.then(...)` and return a placeholder string), or stash the eventual result on a global and read it back.
- **Synthesized DOM events don't trigger WebExtension APIs.** `element.click()` and `dispatchEvent(new MouseEvent(...))` won't fire `browser.browserAction.onClicked`. The OS-level keyboard shortcut for `browser.commands` also can't be reliably synthesized from chrome scope. For end-to-end testing of these triggers, the user has to press them manually.

## Reloading the extension after code changes

**Critical gotcha:** for this extension (which is `temporarilyInstalled: true`), `AddonManager.getAddonByID(...).reload()` does **not** re-execute `experiment/api.js`. The experiment API scope is cached even though the addon reports as reloaded. Symptoms: code changes to api.js appear "not deployed" — debug logs from new code never fire, but the extension still works (running stale code).

**Fix:** disable then re-enable.

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

For changes that touch only `background.js` or `popup/`, plain `reload()` is usually enough — but when in doubt, disable+enable. If your debug logs aren't firing after a reload, this is almost always the cause.

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

## Useful one-liners

```js
// Active tab info
(() => { const w = Services.wm.getMostRecentWindow("navigator:browser"); const t = w.gBrowser.selectedTab; return { id: t.id, label: t.label, url: t.linkedBrowser?.currentURI?.spec, hasParent: !!t.openerTab }; })()

// All tab elements (cross-workspace)
(() => Services.wm.getMostRecentWindow("navigator:browser").document.querySelectorAll(".tabbrowser-tab").length)()

// Overlay state
(() => { const w = Services.wm.getMostRecentWindow("navigator:browser"); const o = w.document.getElementById("zen-tabs-panel-overlay"); return o ? { id: o.id, closing: o.dataset.closing || "no" } : "absent"; })()

// Recent JS errors mentioning the extension
(() => Services.console.getMessageArray().slice(-30).map(m => m.message || String(m)).filter(s => s.toLowerCase().includes("zen-tabs") || s.toLowerCase().includes("error")).slice(-5).join(" || "))()
```
