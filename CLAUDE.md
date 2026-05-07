# Zen Tabs Panel

Firefox MV2 WebExtension + Experiment API for Zen Browser. Command palette for tab management.

## Architecture

Three execution contexts — they cannot share code or globals:

1. **`experiment/api.js`** — Chrome-privileged parent process. Full access to `gBrowser`, `gZenWorkspaces`, `gZenMods`, chrome DOM. Exposes `browser.zenWorkspaces.*` API. Also creates the palette overlay.
2. **`background.js`** — Extension background script. Routes messages between popup and experiment API. Owns auto-close/auto-move logic.
3. **`popup/`** — Content process inside a XUL `<browser>` element. No chrome access. Communicates via `browser.runtime.sendMessage` to background.js.

## Critical Gotchas

**Experiment scope is limited:** `PathUtils`, `IOUtils`, `TextEncoder`, `setTimeout` are NOT available. Access them from the window: `const { PathUtils, IOUtils } = Services.wm.getMostRecentWindow("navigator:browser")` and `new w.TextEncoder()`.

**Experiment API is lazy:** `getAPI()` only runs when the extension first calls `browser.zenWorkspaces.*`. Background.js forces this with `browser.zenWorkspaces.getActiveWorkspaceId().catch(() => {})` at startup.

**Cross-workspace tabs:** `browser.tabs.query()` only returns current workspace tabs. `browser.tabs.update(tabId, {active:true})` silently no-ops cross-workspace. Use `document.querySelectorAll(".tabbrowser-tab")` for all tabs and `gZenWorkspaces.changeWorkspaceWithID(uuid)` + `gBrowser.selectedTab = tab` to switch.

**Palette overlay:** Can't use `browserAction` popup (XUL panel positioning is C++-level). Instead, a `<div>` overlay is injected into chrome DOM containing a `createXULElement("browser")` with `remote="true"` to load the popup HTML. Regular `<iframe>` cannot load `moz-extension://` URLs.

**Chrome CSS:** No nesting syntax. `!important` usually required. `.tabbrowser-tab` has `overflow: clip` — pseudo-elements on it get clipped; target `.tab-content` instead.

## Companion Mods

The extension can install Zen Mods programmatically. Each mod is defined in `COMPANION_MODS` in `api.js` with an id, CSS, and version. Install writes CSS to `<profile>/chrome/zen-themes/<id>/chrome.css` and registers in `<profile>/zen-themes.json`, then calls `gZenMods.triggerModsUpdate()`. Version comparison enables update detection in settings.

## Theming

Panel container (chrome context) uses `var(--arrowpanel-background)` and `var(--zen-colors-border)`. Popup (content context) uses `light-dark()` CSS function. Theme is passed via URL param `?theme=dark|light` based on `zen-should-be-dark-mode` attribute.

## Live Debugging

**Always debug live** — evaluate JS in the browser chrome context to inspect state, reproduce bugs, and verify fixes instead of deploying code changes and guessing.

**Use `python3 tools/firefox-eval.py '<js expression>'`** — connects to the running Zen instance's DevTools RDP server on `127.0.0.1:6000` and evaluates the expression in the chrome-privileged parent process (same scope as `experiment/api.js`). Access the browser window via `Services.wm.getMostRecentWindow("navigator:browser")` which gives `gBrowser`, `gZenWorkspaces`, chrome DOM, etc.

**Use this to:** inspect tab state, test DOM queries, verify API behavior, reproduce bugs, check attribute values — before writing any fix.

**Zen must be started with the RDP server.** The user runs:

```
/Applications/Zen.app/Contents/MacOS/zen --start-debugger-server 6000
```

If `firefox-eval.py` returns "could not get console actor" or the connection fails, Zen is either not running or wasn't started with that flag. **Prompt the user to run the command above** rather than trying to work around it — silent live-debugging beats blind code changes. To check the port directly: `nc -z 127.0.0.1 6000`.

## References

- `ZEN_INTERNALS.md` — Zen Browser API reference (gZenWorkspaces, gZenViewSplitter, gZenMods, tab attributes, DOM structure, split view, compositor behavior)
- `DEBUGGING.md` — live-debugging recipes: starting Zen with the RDP server, useful eval patterns, the `disable+enable` reload gotcha for experiment API changes, capturing keystrokes from chrome scope
