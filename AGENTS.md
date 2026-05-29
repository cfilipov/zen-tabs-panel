# ErgoZen

Firefox MV2 WebExtension + Experiment API for Zen Browser. Command palette for tab management.

## Source Root

`src/` is the extension source. It builds into the generated `dist/` extension root with `npm run build`; Zen should load `dist/manifest.json`.

Do not edit generated `dist/` files.

## Architecture

Three execution contexts — they cannot share code or globals:

1. **`src/experiment/api.js`** — Chrome-privileged parent process. Full access to `gBrowser`, `gZenWorkspaces`, `gZenMods`, chrome DOM. Exposes `browser.zenWorkspaces.*` API. Also creates the palette overlay.
2. **`src/background.js`** — Extension background script. Routes messages between popup and experiment API. Owns auto-close/auto-move logic.
3. **`src/popup/`** — Content process inside a XUL `<browser>` element. No chrome access. Communicates via `browser.runtime.sendMessage` to background.js.

## Architecture Guardrails

The current design intentionally separates capture, sequence, model, and render
ownership. Keep new features inside these boundaries:

- **ChordSession owns chord progression.** `src/experiment/chord-session.js`
  is the only chord-tree traverser and owns replay traces, bridge state, leader
  timing, reveal deferral/blocking, and state invariants. Do not add a second
  chord matcher in popup, background, or content scripts.
- **Physical-key ingress owns exactly-once key consumption.**
  `src/experiment/chord-key-ingress.js` is the boundary every chrome-side
  keystroke path crosses before it reaches `ChordSession.acceptKey`: chrome
  shim, content shim, root fallback, and hidden-chain fallback all submit
  normalized key data through `ingress.submit(keyData, source)`. No path should
  call `acceptKey` or `forwardKeyToPopup` directly to handle a physical key.
- **Shims only capture keys.** `src/shared/chord-shim.js` and the chrome/content
  listeners synchronously suppress capturable keydowns and forward normalized
  keys to `ChordSession`. They should stay stateless apart from armed/disarmed
  and their fail-safe timeout.
- **Overlay lifecycle state lives in `overlay-controller`.** Popup instance
  gating, pending reveal closures, morph generations, current view params, nav
  stack, and resize diagnostics belong to `src/experiment/overlay-controller.js`.
  `api.js` should provide the chrome/XUL implementation details; do not scatter
  popup-instance or pending-reveal state back into top-level globals.
- **Popup readiness gating is a named boundary.**
  `src/experiment/popup-readiness-guard.js` owns
  `acceptsPopupViewStateMessage(deps, inst, readyGen)`, the authority for
  whether inbound popup-to-chrome state writes are accepted. Visible mouse
  navigation may omit `readyGen` only when there is no active bridge and no
  pending reveal.
- **Chrome view transitions go through the coordinator.**
  `createChromeViewTransitionCoordinator` in `src/experiment/api.js` owns every
  write to `overlayController.setCurrentView` / `resetViewState`, every
  `chordSession.retargetActiveBridgeView`, every `armRevealTimer`, and every
  `WarmRearm` send. Enforcement lives in
  `src/experiment/chrome-view-transition-boundary.test.ts`, which strips the
  coordinator body and greps the remaining source for forbidden call shapes.
- **Chrome owns authoritative view models where migrated.** Recents, tab lists,
  domains, workspaces, folders, containers, profiles, duplicates, actions, and
  duplicate-prompt tab rows are driven by chrome-side DTO/model APIs. The popup
  renders DTOs and reports row intents with stable row IDs and sequence/list
  versions. Do not rebuild a parallel recents/tabs/domains/workspaces model in
  Svelte.
- **Popup owns visible UI interaction only.** Structural UI keys such as arrows,
  Enter, Tab, Space, Escape, Backspace, sort/filter toggles, preview, and close
  hints live under `src/popup/interaction/` and `src/popup/runtime/`. Prefer
  pure helpers with tests for decisions, with `NativePalette.svelte` acting as
  wiring for stores/effects/lifecycle.
- **Background remains the runtime router.** `src/background.js` routes
  WebExtension messages and executes runtime actions. It should not maintain
  chord replay state; call `recordRuntimeActionForReplay` and let
  `ChordSession` decide whether to promote an in-flight chord trace or store a
  raw runtime action.
- **Never duplicate model ownership for convenience.** If chrome needs to
  resolve a key, move that view's model to chrome and send compact DTOs to the
  popup. If the popup still owns a special-case UI view, keep chrome's knowledge
  transitional and explicit. Two independently computed row orders are a bug
  class, not an optimization.

### Boundary Enforcement Pattern

When a new owner boundary is introduced, ship the enforcement test in the same
commit. The two cheapest patterns are source-grep tests that forbid bypassing a
coordinator and small pure modules, like `popup-readiness-guard.js`, that can be
loaded directly in unit tests with injected dependencies.

## Critical Gotchas

**Experiment scope is limited:** `PathUtils`, `IOUtils`, `TextEncoder`, `setTimeout` are NOT available. Access them from the window: `const { PathUtils, IOUtils } = Services.wm.getMostRecentWindow("navigator:browser")` and `new w.TextEncoder()`.

**Experiment API is lazy:** `getAPI()` only runs when the extension first calls `browser.zenWorkspaces.*`. Background.js forces this with `browser.zenWorkspaces.getActiveWorkspaceId().catch(() => {})` at startup.

**Cross-workspace tabs:** `browser.tabs.query()` only returns current workspace tabs. `browser.tabs.update(tabId, {active:true})` silently no-ops cross-workspace. Use `document.querySelectorAll(".tabbrowser-tab")` for all tabs and `gZenWorkspaces.changeWorkspaceWithID(uuid)` + `gBrowser.selectedTab = tab` to switch.

**Palette overlay:** Can't use `browserAction` popup (XUL panel positioning is C++-level). Instead, a `<div>` overlay is injected into chrome DOM containing a `createXULElement("browser")` with `remote="true"` to load the popup HTML. Regular `<iframe>` cannot load `moz-extension://` URLs.

**Chrome CSS:** No nesting syntax. `!important` usually required. `.tabbrowser-tab` has `overflow: clip` — pseudo-elements on it get clipped; target `.tab-content` instead.

## Keybindings and the chord engine

### The mental model — one chord tree, one leader (plus an alternate), three timing windows

The chord chain is `<leader>, <key>, <key>, …` where `<leader>` is either of the configurable `open-palette` shortcuts declared in `src/manifest.json` under `commands` (defaults: `cmd+.` and the `cmd+option+.` alternate). Both do the same thing — they're alternates so the user can pick whichever modifier isn't eaten by the focused page. Customize them in `about:addons` → Manage Extension Shortcuts. The command palette also has its own configurable `open-command-palette` shortcut, defaulting to `cmd+shift+p`, which opens fuzzy command search directly without arming a chord session.

Everything after the leader flows from the navigation tree defined once in `src/shared/navigation-tree.ts`; `scripts/generate-keybindings.mjs` emits `dist/shared/keybindings.js` for the chrome-scope session. The same sequence of keys does the same thing whether the user types it fast (no UI), slowly enough that the menu fades in (with UI), or with a key mid-fade-in (the bridge case):

- **Fast** (`cmd+., o, r`): `ChordSession` matches the keys against the tree and fires the terminal action — `reorder-all-tabs`, in this example — without showing any UI.
- **Slow** (`cmd+., [wait], o, r`): the session's root timer fires, the menu opens, the user types `o` into the menu (descend to Reorder submenu), then `r` (fire action). Same outcome as fast path.
- **Mid-fade-in** (`cmd+., [hesitate], p`): the root timer triggered the menu to open but the user's next key arrives during the fade-in. The session is in bridge state — the armed shim captures the key and chrome buffers it. When the popup signals `POPUP_READY`, the buffered key is replayed into the popup and fires the action mid-fade-in.

In code this means: there is one source tree in `src/shared/navigation-tree.ts`. Adding a new entry there gives it the fast path, the slow path, and the bridge path automatically. The popup's view-item hotkeys are populated from `entry.chord`, so the on-screen badge and the matcher always agree.

UI-augmentation keys are explicitly **not** part of the chord set — Space (paginate the actions menu), Tab (jump section), Arrow keys (navigate selection), Enter (activate), Escape (close), Backspace (back/close). These only make sense when the menu is visible and live in `src/popup/interaction/interpreter.ts`. The chord-tree keys (letters, digits, Shift+digit) ARE chord keys and behave identically in all three timing windows.

### How the leader arms the session and shims

The configurable leader shortcuts are modifier-key combos, so Firefox's keyset matches them at chrome level and routes via `browser.commands.onCommand`. The handler in `background.js` calls `api.armChord()`, which:

1. Arms the chrome-side `ChordSession` (`src/experiment/chord-session.js`), which owns tree traversal, replay, bridge state, and chord timers.
2. Arms the chrome key-capture shim synchronously.
3. Sends a targeted `ZenChord:Arm` message to the currently-focused tab's content `messageManager` so its content shim arms too.

The shims do not traverse the chord tree. While armed, they synchronously suppress capturable keys in their own process and forward normalized key data to the one chrome-side session. When the session reaches a terminal action or cancel state, chrome broadcasts `ZenChord:Disarm:<gen>` so every shim drops back to idle.

### Key-capture shims (the chrome+content split)

In Firefox e10s, the chrome process cannot synchronously suppress a content-routed keystroke via standard `preventDefault` from a chrome-window listener — the IPC forwarding the event to the content process has already shipped by the time the chrome-side listener runs. To make `cmd+., p` typed fast in a focused content input not leak `p`, the chord state machine has to run **in the same process as the content keydown dispatch**.

The current solution is one chrome-side state machine plus two lightweight shims:

1. **Chrome shim** in `src/experiment/api.js`. Listens on the chrome window (capture phase + `mozSystemGroup`). For chrome targets, `preventDefault` works locally and the normalized key is passed directly into `ChordSession.acceptKey`.
2. **Content shim** loaded via a per-content-process frame script (`Services.mm.loadFrameScript`). The frame-script body is constructed in `installContentShimFrameScript()` in `src/experiment/api.js`, loads `shared/chord-shim.js`, and attaches to `content`. It skips the palette/hosted-popup browser so those views own their own keys. For content keys, `preventDefault` runs in the content process before the editor's default action, then the normalized key is sent as `ZenChord:Key:<gen>`.

Both shims are armed in parallel by `armChord` (see above). The first shim to see the next non-modifier key suppresses it locally and forwards it to chrome. The session is the only chord-tree traverser, so there is no duplicated engine state to keep in sync.

### Why `<key>`/keysets do not work for plain letters

The XUL `<keyset>` mechanism that Firefox uses for `cmd+T`, `cmd+W`, etc. **does not match plain-letter `<key>` elements**. Verified empirically — every keyset in the chrome document (Firefox's `mainKeyset`, Zen's `zenKeyset`, every installed extension's keyset) has zero plain-letter entries. Modifier-key combos (`cmd+T`, `accel+shift+P`) match. Special keycodes (F-keys, navigation keys) match. Plain letters bypass the matcher entirely and route directly to the focused widget.

This is a deliberate Firefox property, not a bug. It's also why a chrome-side JS `preventDefault` (even with `mozSystemGroup: true`) cannot synchronously stop a content-routed plain-letter keystroke — that pipeline is reserved for command-key shortcuts.


### Dynamic chord entries (extension-popup quick-launch)

`Shift+1..9` are bound at runtime to the first 9 installed extensions' popups (Bitwarden, uBlock, etc.) by `buildExtensionList()` in `experiment/api.js`. The chrome-side `CHORD_TREE.children["Shift+N"]` is mutated directly. Content frame scripts are now key-capture shims, so they do not need dynamic chord entries; they only forward normalized keys to `ChordSession`, which reads the current chrome-side tree at match time.

### Bridge handshake

When `ChordSession` matches an `open-view` chord, it transitions to bridge state instead of going back to idle. While bridging and hidden, armed shims keep forwarding non-modifier keys to the session. Chrome either resolves the key directly for chrome-owned row models or buffers it in the session's bridge buffer for the popup to drain.

The popup is still the keyboard/UI processor for visible interaction, but some row models are now chrome-owned so fast hidden chords can resolve without waiting for Svelte. Chord chains stream unresolved keys into a popup that is created hidden on chord arm. When the popup bridge finishes init and sends `MSG.POPUP_READY` to background, the reply is `{ buffered, stateSnapshot, stale? }`:

- `buffered`: the captured keys, replayed via `dispatchKey(makeSyntheticKeyEvent(k))` into the popup.
- `stateSnapshot`: the chord-tree path the session was at when bridging began (e.g. `["O"]` for the Reorder prefix). The URL `?view=` param usually drives the right view, but the snapshot remains available for diagnostics/future bridge use.
- `stale: true`: chrome's `popupInstance` doesn't match the popup's `?inst=N` URL param. The popup bails out without draining or processing live keys — it's a soon-to-be-destroyed prerender.

The popup bridge controller holds any live keys (delivered via `ZenChord:DeliverKey:<gen>` post-POPUP_READY) before the drain completes; they're replayed after the buffered ones, preserving order. After POPUP_READY, chrome forwards subsequent unresolved bridge keys live to the popup's frame script (`br.messageManager.sendAsyncMessage`), which dispatches a synthetic `KeyboardEvent` on `content.document`.

### Reveal timing — chrome timer + popup timer + reveal-blocked flag

The popup stays invisible during a chord chain. Two timers govern reveal:

- **Chrome reveal timer** (owned by `ChordSession`, armed from `experiment/api.js`) — armed on `enterBridgeFromOpenView`, cleared the moment any chord key is forwarded (`forwardKeyToPopup`). Fires only if the user pauses after `open-view` without typing another chord key (e.g., `cmd+., q [pause]`). If the popup hasn't drained yet when the timer fires, it sets `revealDeferred = true` and bails — `takeChordBridgeBuffer` consumes that flag and reveals one tick after POPUP_READY for empty drains.
- **Popup reveal timer** (in `src/popup/runtime/palette-reveal.ts`) — armed **after** each dispatched key handler completes (not at dispatch start). For drills, arming at dispatch start would fire mid-drill and reveal before the next chord-chain key could process. Each subsequent dispatch resets the timer; on pause, it sends `MSG.REVEAL_PALETTE` to chrome with its `inst`.

To prevent the popup-side timer from racing the terminal-action destroy round-trip and revealing a popup that's already destroying, `destroyOverlay` sets `ChordSession`'s `revealBlocked` flag, cleared on the next `createOverlay`. `revealPalette` checks this flag — any stale timer firing during the destroy window is a no-op.

Terminal-action helpers also clear the popup reveal timer before sending the message, as defense in depth against teardown losing the race.

### Default-group blocker — stopping page keybindings

System-group `preventDefault` from the shim suppresses the **default browser action** (character insertion), which is enough to fix the `cmd+., p` character leak. It does NOT stop **custom page keydown handlers** registered by sites (e.g., Reddit's bare-`q` sidebar toggle). System group and default group propagate independently; `stopPropagation` from one doesn't reach the other.

The fix is a second listener attached in **default group** capture phase at the window level (in the per-content-process frame script). When the shim is armed, it `stopPropagation`s — preventing the event from reaching page handlers on inner nodes (document/body/specific elements). Our system-group shim on the same window still fires (same node, different group); only travel to other nodes is stopped. Frame scripts run at `document_start` so this listener is registered before any page script can attach competing listeners.

### Frame-script accumulation gotcha

Firefox does NOT unload frame scripts on extension reload. Every `disable+enable` cycle leaves the prior frame script registered in each content process AND in `Services.mm`'s delayed-script queue. Without mitigation, every reload adds a permanent stale shim that fires on every keystroke. Two defenses:

1. **Generation tagging.** Each load mints a unique `CHORD_GENERATION` string. Shim key IPC uses generation-tagged message names such as `ZenChord:Key:<gen>`, and chrome only listens to the current generation. `ZenChord:DeliverKey:<gen>` is also gen-tagged so stale popup/content listeners never fire.
2. **Aggressive teardown.** `teardownChordShims` (registered via `context.callOnClose`) iterates `Services.mm.getDelayedFrameScripts()` and removes every chord-shim entry — not just the current generation's URL. This stops new content processes from auto-loading stale scripts. Currently-loaded stale scripts in existing processes can't be fully unloaded; they receive `ZenChord:Shutdown` broadcast which detaches their shim and sets `__shutdown=true`. Pre-shutdown-handler versions can't be cleanly stopped — a Firefox restart is the only recovery.

### Popup-instance gating

Each `createOverlay` increments `popupInstance` and bakes the value into the popup URL as `?inst=N`. The popup reads it and echoes it back in `POPUP_READY` and `REVEAL_PALETTE` messages. Chrome's handlers reject mismatched `inst` (the popup has since been replaced by a prerender swap). Without this, a stale destroyed popup's late `POPUP_READY` would drain the bridge buffer that the live popup is waiting for, eating the chord-chain digits.

### Silent prerender swap

When chord arms (via `armChord`), chrome creates a hidden prerender at the default `actions` view so the popup loads during the chord wait. When the user types an `open-view` chord key, the requested view doesn't match the prerender — chrome calls `destroyOverlay({silent: true})` then a fresh `createOverlay(requestedView)`. The `silent` flag is critical: the regular destroy path calls `finishBridge`, disarms shims, and clears the session bridge buffer. For a swap, we want the bridge to survive — the new popup will drain it.

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
