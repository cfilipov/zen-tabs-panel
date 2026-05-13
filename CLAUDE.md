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

## Keybindings and the chord engine

### The mental model — one set of bindings, three timing windows

The user memorizes a single entry point: `cmd+cmd` (double-tap the Cmd modifier). Everything else flows from a chord tree defined once in `shared/keybindings.js`. The exact same sequence of keys does the same thing whether the user types it fast (no UI), slowly enough that the menu fades in (with UI), or with a key mid-fade-in (the bridge case):

- **Fast** (`cmd+cmd, o, r`): the chord engine matches the keys against the tree and fires the terminal action — `reorder-all-tabs`, in this example — without showing any UI.
- **Slow** (`cmd+cmd, [wait], o, r`): the engine's root timer fires, the menu opens, the user types `o` into the menu (descend to Reorder submenu), then `r` (fire action). Same outcome as fast path.
- **Mid-fade-in** (`cmd+cmd, [hesitate], p`): the root timer triggered the menu to open but the user's next key arrives during the fade-in. The originating engine is in `bridging` state — it captures the key and chrome buffers it. When the popup signals `POPUP_READY`, the buffered key is replayed into the popup and fires the action mid-fade-in.

In code this means: there is one `shared/keybindings.js`. Adding a new entry there gives it the fast path, the slow path, and the bridge path automatically. The popup's view-item hotkeys are populated from `entry.chord` (see `actionFromRegistry` in `popup/popup.js`), so the on-screen badge and the matcher always agree.

UI-augmentation keys are explicitly **not** part of the chord set — Space (paginate the actions menu), Tab (jump section), Arrow keys (navigate selection), Enter (activate), Escape (close), Backspace (back). These only make sense when the menu is visible and live in `popup/keyboard.js`'s `KEY_HANDLERS` plus the view-specific `handleListViewKey` (W/O/B/F/S/0/digit-row-select). The chord-tree keys (letters, digits, Shift+digit) ARE chord keys and behave identically in all three timing windows.

### Dual autonomous chord engines (the chrome+content split)

In Firefox e10s, the chrome process cannot synchronously suppress a content-routed keystroke via standard `preventDefault` from a chrome-window listener — the IPC forwarding the event to the content process has already shipped by the time the chrome-side listener runs. To make `cmd+cmd, p` typed fast in a focused content input not leak `p`, the chord state machine has to run **in the same process as the content keydown dispatch**.

The solution is two instances of the same state machine — `shared/chord-engine.js` — running autonomously:

1. **Chrome engine** in `experiment/api.js`. Listens on the chrome window (capture phase + `mozSystemGroup`). `filterEvent` rejects events whose target is a `<browser>` element, so it only acts on chrome-routed keystrokes (URL bar, browser chrome). For chrome targets, `preventDefault` works locally — no race.
2. **Content engine** loaded via a per-content-process frame script (`Services.mm.loadFrameScript`). The frame-script body is constructed in `installContentEngineFrameScript()` in `experiment/api.js` as a data: URL that `loadSubScript`s the same `shared/chord-engine.js` and instantiates an engine attached to `content`. Skips activation for `moz-extension://` documents (our popup and foreign-extension popups handle their own keys). For content keys, `preventDefault` from the engine runs in the content process before the editor's default action — no race.

The two engines never communicate. They observe the same physical user events (Meta keyups, etc.) and arrive at the same chord state by coincidence (same events, same code). Each is fully autonomous in its focus domain.

Cross-process IPC is **output-only** from the content engine: when it fires an action, it sends a `ZenChord:Action` / `ZenChord:OpenView` / `ZenChord:Cancel` / `ZenChord:Armed` / `ZenChord:BridgeKey` message. Chrome receives and dispatches. The IPC never gates a synchronous chord-key decision, so it can never race.

### Why `<key>`/keysets do not work for plain letters

The XUL `<keyset>` mechanism that Firefox uses for `cmd+T`, `cmd+W`, etc. **does not match plain-letter `<key>` elements**. Verified empirically — every keyset in the chrome document (Firefox's `mainKeyset`, Zen's `zenKeyset`, every installed extension's keyset) has zero plain-letter entries. Modifier-key combos (`cmd+T`, `accel+shift+P`) match. Special keycodes (F-keys, navigation keys) match. Plain letters bypass the matcher entirely and route directly to the focused widget.

This is a deliberate Firefox property, not a bug. It's also why a chrome-side JS `preventDefault` (even with `mozSystemGroup: true`) cannot synchronously stop a content-routed plain-letter keystroke — that pipeline is reserved for command-key shortcuts.

### Dynamic chord entries (extension-popup quick-launch)

`Shift+1..9` are bound at runtime to the first 9 installed extensions' popups (Bitwarden, uBlock, etc.) by `buildExtensionList()` in `experiment/api.js`. The chrome-side `CHORD_TREE.children["Shift+N"]` is mutated directly. Each frame-script engine receives the same entries via a `ZenChord:AddChord` broadcast (and any frame script that initialized late asks for them via `ZenChord:Hello`, which chrome replies to per-frame).

### Bridge handshake

When an engine fires `open-view`, it transitions to `bridging` state instead of going back to idle. While bridging, the engine captures non-modifier keys and forwards them: chrome's engine pushes to a local `bridgeBuffer`; content's engine sends `ZenChord:BridgeKey` to chrome which appends to the same buffer.

The popup is the **sole keyboard processor**. Chord chains stream keys into a popup that is created hidden (`visibility: hidden`) on chord arm. The popup's `keyboard.js` is the only place that knows what each key means in each view — chrome never duplicates view-specific logic. When `popup/keyboard.js` finishes init and sends `MSG.POPUP_READY` to background, the reply is `{ buffered, stateSnapshot, stale? }`:

- `buffered`: the captured keys, replayed via `dispatchKey(makeSyntheticKeyEvent(k))` into the popup.
- `stateSnapshot`: the chord-tree path the originating engine was at when bridging began (e.g. `["O"]` for the Reorder prefix) — currently not used by the popup (the URL `?view=` param already drives the right view), but reserved for any future popup-side chord-engine instance.
- `stale: true`: chrome's `popupInstance` doesn't match the popup's `?inst=N` URL param. The popup bails out without draining or processing live keys — it's a soon-to-be-destroyed prerender.

The popup's `chordBridgeReady` flag holds any live keys (delivered via `ZenChord:DeliverKey:<gen>` post-POPUP_READY) before the drain completes; they're replayed after the buffered ones, preserving order. After POPUP_READY, chrome forwards each subsequent bridge key live to the popup's frame script (`br.messageManager.sendAsyncMessage`), which dispatches a synthetic `KeyboardEvent` on `content.document`.

### Reveal timing — chrome timer + popup timer + reveal-blocked flag

The popup stays invisible during a chord chain. Two timers govern reveal:

- **Chrome reveal timer** (in `experiment/api.js`) — armed on `enterBridgeFromOpenView`, cleared the moment any chord key is forwarded (`forwardKeyToPopup`). Fires only if the user pauses after `open-view` without typing another chord key (e.g., `cmd+cmd, q [pause]`). If the popup hasn't drained yet when the timer fires, it sets `revealDeferred = true` and bails — `takeChordBridgeBuffer` consumes that flag and reveals one tick after POPUP_READY for empty drains.
- **Popup reveal timer** (in `popup/keyboard.js`) — armed **after** each `dispatchKey` handler completes (not at dispatch start). For drills (`await navigateToView`) the handler takes ~470ms (220ms cross-fade + render); arming at dispatch start would fire mid-drill and reveal before the next chord-chain key could process. Each subsequent dispatch resets the timer; on pause, it sends `MSG.REVEAL_PALETTE` to chrome with its `inst`.

To prevent the popup-side timer from racing the terminal-action destroy round-trip and revealing a popup that's already destroying, `destroyOverlay` sets a `revealBlocked` flag, cleared on the next `createOverlay`. `revealPalette` checks this flag — any stale timer firing during the destroy window is a no-op.

Terminal-action helpers (`activateTab`, `closePalette` in `popup/popup.js`) also explicitly call `window.clearPopupRevealTimer` before sending the message, as defense in depth against `pagehide` losing the race.

### Default-group blocker — stopping page keybindings

System-group `preventDefault` from the chord engine suppresses the **default browser action** (character insertion), which is enough to fix the `cmd+cmd, p` character leak. It does NOT stop **custom page keydown handlers** registered by sites (e.g., Reddit's bare-`q` sidebar toggle). System group and default group propagate independently; `stopPropagation` from one doesn't reach the other.

The fix is a second listener attached in **default group** capture phase at the window level (in the per-content-process frame script). When the engine is armed, it `stopPropagation`s — preventing the event from reaching page handlers on inner nodes (document/body/specific elements). Our system-group engine on the same window still fires (same node, different group); only travel to other nodes is stopped. Frame scripts run at `document_start` so this listener is registered before any page script can attach competing listeners.

### Frame-script accumulation gotcha

Firefox does NOT unload frame scripts on extension reload. Every `disable+enable` cycle leaves the prior frame script registered in each content process AND in `Services.mm`'s delayed-script queue. Without mitigation, every reload adds a permanent stale engine that fires on every keystroke. Two defenses:

1. **Generation tagging.** Each load mints a unique `CHORD_GENERATION` string. All engine-fired IPCs include `__gen`; chrome's `isCurrentGen` filters out stale generations' messages. The `ZenChord:DeliverKey:<gen>` IPC message **name** is also gen-tagged so stale `addMessageListener` registrations never fire (they're subscribed to old names).
2. **Aggressive teardown.** `teardownChordEngines` (registered via `context.callOnClose`) iterates `Services.mm.getDelayedFrameScripts()` and removes every chord-engine entry — not just the current generation's URL. This stops new content processes from auto-loading stale scripts. Currently-loaded stale scripts in existing processes can't be fully unloaded; they receive `ZenChord:Shutdown` broadcast which detaches their engine and sets `__shutdown=true`. Pre-shutdown-handler versions can't be cleanly stopped — a Firefox restart is the only recovery.

### Popup-instance gating

Each `createOverlay` increments `popupInstance` and bakes the value into the popup URL as `?inst=N`. The popup reads it and echoes it back in `POPUP_READY` and `REVEAL_PALETTE` messages. Chrome's handlers reject mismatched `inst` (the popup has since been replaced by a prerender swap). Without this, a stale destroyed popup's late `POPUP_READY` would drain the bridge buffer that the live popup is waiting for, eating the chord-chain digits.

### Silent prerender swap

When chord arms via `cmd+cmd`, chrome creates a hidden prerender at the default `actions` view so the popup loads during the chord wait. When the user types an `open-view` chord key, the requested view doesn't match the prerender — chrome calls `destroyOverlay({silent: true})` then a fresh `createOverlay(requestedView)`. The `silent` flag is critical: the regular destroy path calls `finishBridge` which broadcasts `ZenChord:ExitBridge`, resetting the engine's bridging state and discarding `bridgeBuffer`. For a swap, we want the bridge to survive — the new popup will drain it.

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
