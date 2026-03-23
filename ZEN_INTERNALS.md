# Zen Browser Internals Reference

Discovered via Browser Toolbox (`Cmd+Opt+Shift+I` on macOS) against Zen Browser built on Firefox 148.0.2.

> **Note:** These are undocumented internal APIs. They may change between Zen versions without notice.

## Enabling Browser Toolbox

Requires three prefs in `about:config`:

- `devtools.debugger.remote-enabled` → `true`
- `devtools.chrome.enabled` → `true`
- `toolkit.legacyUserProfileCustomizations.stylesheets` → `true`

After Zen 1.0.0-a.31 the Browser Developer Tools are disabled by default for security.

Open with `Cmd+Opt+Shift+I` (macOS) / `Ctrl+Shift+Alt+I` (other platforms).

**Tip:** Enable "Disable Popup Auto-Hide" from the Browser Toolbox's `⋯` menu to inspect popups/panels without them closing on blur.

---

## Global Objects

Found via `Object.getOwnPropertyNames(window)`:

### Zen-specific globals

```
gZenWorkspaces          — Workspace management
gZenViewSplitter        — Split view management
gZenMods                — Zen Mods (CSS themes) system
gZenVerticalTabsManager — Vertical tab bar management
gZenCompactModeManager  — Compact mode (auto-hide tab bar)
gZenUIManager           — General UI management
gZenStartup             — Startup/initialization
gZenSessionStore        — Session persistence
gZenKeyboardShortcutsManager — Keyboard shortcut management
gZenOperatingSystemCommonUtils — OS-specific utilities
gZenCommonActions       — Common browser actions
```

### Zen-specific standalone functions/objects

```
getWorkspaceID(tab)           — Returns workspace ID for a native tab element
moveToWorkspace()             — [native code] Move tab to workspace
ZenCustomizableUI            — UI customization
ZenHasPolyfill               — Polyfill detection
ZenWorkspaceBookmarksStorage — Bookmark storage per workspace
ZEN_KEYSET_ID                — Keyset identifier constant
ZenDragAndDrop               — Drag and drop handling
ZenThemeModifier             — Theme/color modification
ZenSessionManager            — Session manager (separate from gZenSessionStore, runs as a module — ZenSessionManager.sys.mjs)
```

### Standard Firefox globals (useful)

```
gBrowser                — The main tabbrowser element
SessionStore            — Firefox session store
Services                — XPCOM services (prefs, window manager, etc.)
```

---

## gZenWorkspaces

### Key Properties

```js
Object.keys(gZenWorkspaces)
// → ["lastSelectedWorkspaceTabs", "draggedElement", "_workspaceCache",
//    "bookmarkMenus", "_resolvePinnedInitialized", "promisePinnedInitialized",
//    "promiseInitialized", "_shouldHaveWorkspaces", "_tabSelectionState",
//    "_workspaceChangeInProgress", ...]
```

**`activeWorkspace`** — UUID string of the currently active workspace.
```js
gZenWorkspaces.activeWorkspace
// → "{12928a83-e0d9-46da-bf4f-8dafdda756f8}"
```

**`lastSelectedWorkspaceTabs`** — Object mapping workspace UUID → last selected native tab element in that workspace. These are live DOM references even for inactive workspaces.
```js
gZenWorkspaces.lastSelectedWorkspaceTabs
// → {
//   "{12928a83-...}": <tab element>,
//   "{4cd2dd72-...}": <tab element>
// }
```

**`_workspaceCache`** — Array of workspace metadata objects (indexed 0, 1, ...). Contains name, UUID, theme, icon — but NOT tab data.

### Key Methods (81 total)

All methods:
```js
Object.getOwnPropertyNames(Object.getPrototypeOf(gZenWorkspaces))
  .filter(k => typeof gZenWorkspaces[k] === 'function').sort()
// → ["_animateTabs", "_cancelSwipeAnimation", "_fixCtrlTabBehavior",
//    "_fixIndicatorsNames", "_handleAppCommand", "_handleTabSelection",
//    "_organizeWorkspaceStripLocations", "_popupOpenHandler",
//    "_safelySelectTab", "_shouldChangeToTab", "addChangeListeners",
//    "addPopupListeners", "changeWorkspace", "changeWorkspaceIcon",
//    "changeWorkspaceWithID", "getEssentialsSection", "getCurrentSpaceContainerId",
//    "getWorkspaceFromId", "getWorkspaces", "init", "log",
//    "registerPinnedResizeObserver", "removeChangeListeners",
//    "selectEmptyTab", "selectStartPage", "workspaceElement", ...]
```

**`getWorkspaces()`** — Returns array of workspace objects.
```js
gZenWorkspaces.getWorkspaces()
// → [
//   {
//     uuid: "{4cd2dd72-73b7-4b03-b984-944100d79c53}",
//     name: "Main",
//     icon: "chrome://browser/skin/zen-icons/selectable/egg.svg",
//     containerTabId: 0,
//     theme: { type: "gradient", gradientColors: [...], opacity: 0.75, texture: 0 }
//   },
//   {
//     uuid: "{12928a83-e0d9-46da-bf4f-8dafdda756f8}",
//     name: "Dev",
//     icon: "chrome://browser/skin/zen-icons/selectable/code.svg",
//     containerTabId: 0,
//     theme: { ... }
//   }
// ]
```

**`changeWorkspaceWithID(uuid)`** — Switches to the workspace with the given UUID. Async. Triggers tab activation events and updates the UI.
```js
await gZenWorkspaces.changeWorkspaceWithID("{4cd2dd72-73b7-4b03-b984-944100d79c53}")
```

**`changeWorkspace(workspaceObj, ...args)`** — Lower-level workspace switch. `changeWorkspaceWithID` calls this internally.

**`getWorkspaceFromId(uuid)`** — Returns the workspace metadata object for a UUID.

**`addChangeListeners(func, opts)`** — Register a callback for workspace changes. `opts` can include `{ once: true }`.
```js
gZenWorkspaces.addChangeListeners(() => console.log("workspace changed!"));
```

**`removeChangeListeners(func)`** — Unregister a change listener.

### Moving Tabs Between Workspaces

**`moveTabsToWorkspace(tabs, workspaceId)`** — Moves an array of native tab elements to the specified workspace. Handles split view cleanup, glance tabs, container reassignment, and cached tab invalidation internally. Does NOT switch to the target workspace — the context menu's "Move to workspace" action does that as a separate step.

Placement behavior: uses `container.insertBefore(tab, container.lastChild)` — tabs are placed near the end of the target workspace's tab list. To place at the top instead, call `container.insertBefore(tab, container.firstChild)` on the tab's `parentNode` after the move.

The tab container uses separate sections for pinned and unpinned tabs, so `insertBefore(tab, firstChild)` on the unpinned container correctly places at the top without mixing into the pinned/essentials range.

**`gBrowser.selectedTabs`** — Returns an array of all multiselected tabs (Ctrl+click). When only one tab is selected, returns `[activeTab]`. Useful for batch operations on user-selected tabs.

### Workspace Behavior

- **Tab isolation:** Zen removes tabs from `gBrowser.tabs` when their workspace is inactive. They are NOT hidden (`.hidden` is false) — they are completely absent from the `gBrowser.tabs` collection.
- **DOM persistence:** Tab elements DO remain in the document DOM even when their workspace is inactive. `document.querySelectorAll(".tabbrowser-tab")` returns ALL tabs across ALL workspaces. `document.getElementById(tabDomId)` works cross-workspace.
- **Tab activation:** `gBrowser.selectedTab = nativeTab` works for activating a tab, but only after switching to its workspace first. `browser.tabs.update(tabId, {active: true})` from the extension API silently no-ops for cross-workspace tabs.
- **Query filtering:** `browser.tabs.query()` from the WebExtension API only returns tabs in the active workspace. `browser.tabs.get(tabId)` works cross-workspace though.
- **Auto-select:** When switching workspaces, Zen automatically selects the last active tab in the target workspace.

### Tab Workspace Identification

Each tab element has a `zen-workspace-id` DOM attribute:
```js
tab.getAttribute("zen-workspace-id")
// → "{12928a83-e0d9-46da-bf4f-8dafdda756f8}"
```

The standalone function `getWorkspaceID(tab)` also returns this, but is `[native code]` so its exact behavior can't be inspected.

---

## gZenViewSplitter

### Key Properties

```js
Object.keys(gZenViewSplitter)
// → ["currentView", "_data", "_tabBrowserPanel", "__hasSetMenuListener",
//    "overlay", "_splitNodeToSplitters", "_tabToSplitNode", "dropZone",
//    "_edgeHoverSize", "minResizeWidth", ...]
```

**`currentView`** — Integer index of the currently active split view (0-indexed). Value is `0` when a split view is active.

**`_data`** — Array of all split view groups. Each group contains:
```js
gZenViewSplitter._data
// → [
//   {
//     groupId: "1773377743616-25",
//     tabs: [<tab element>, <tab element>],  // Live DOM references
//     gridType: "vsep",                       // "vsep" = vertical separator (side by side)
//     layoutTree: {
//       sizeInParent: undefined,
//       positionToRoot: {...},
//       direction: "row",                     // "row" = horizontal layout
//       ...
//     }
//   },
//   { groupId: "1773681718976-75", tabs: [...], gridType: "vsep", ... },
//   ...
// ]
```

### Key Methods (62 total)

```js
Object.getOwnPropertyNames(Object.getPrototypeOf(gZenViewSplitter))
  .filter(k => typeof gZenViewSplitter[k] === 'function').sort()
// → ["_animateDropEdge", "_calculateDropSide", "_createHeader",
//    "_getSplitViewGroup", "_maybeRemoveFakeBrowser", "_moveTabsToContainer",
//    "_oppositeSide", "_removeHeader", "_removeNodeSplitters",
//    "_swapField", ...]
```

**`_getSplitViewGroup(tab)`** — Returns the split group object for a given tab.

### Split View Tab Attributes

Tabs in a split view have:
```
split-view="true"
```

The last tab in a split view (or last split-view-related tab) may also have:
```
last-tab-or-split-view=""
```

### Finding the Current Split Group

```js
let currentTab = gBrowser.selectedTab;
let currentGroup = gZenViewSplitter._data.find(
  g => g.tabs && g.tabs.some(t => t.id === currentTab.id)
);
// currentGroup.tabs → array of all tabs in this split view
// currentGroup.groupId → unique identifier for this split group
```

---

## Tab Element Attributes

Native tab elements (`gBrowser.selectedTab`, items from `gBrowser.tabs`, or `document.querySelectorAll(".tabbrowser-tab")`) have these attributes:

### Standard Firefox

| Attribute | Example | Notes |
|---|---|---|
| `id` | `"1773377568372-76"` | Stable DOM ID, survives workspace swaps |
| `label` | `"Page Title"` | Tab title |
| `image` | `"data:image/png;base64,..."` | Favicon URL |
| `pinned` | `"true"` | Present on pinned tabs (includes Zen Essentials) |
| `fadein` | `"true"` | Tab has finished loading animation |
| `unread` | `"true"` | Tab opened in background, never activated. Removed on first activation |
| `pending` | `"true"` | Tab has been unloaded/discarded from memory |
| `selected` | (attribute presence) | Currently active tab |
| `context` | `"tabContextMenu"` | Context menu ID |
| `linkedpanel` | `"panel-3-4"` | Associated panel ID |
| `aria-posinset` | `"3"` | Position in tab set |
| `aria-setsize` | `"8"` | Total tabs in set |
| `aria-level` | `"1"` | Nesting level |
| `labeldirection` | `"ltr"` | Text direction |
| `skipbackgroundnotify` | `"true"` | Skip background notification |

### Zen-specific

| Attribute | Example | Notes |
|---|---|---|
| `zen-workspace-id` | `"{uuid}"` | Workspace this tab belongs to |
| `split-view` | `"true"` | Tab is in a split view |
| `last-tab-or-split-view` | `""` | Last tab or part of last split view |
| `notselectedsinceload` | `"true"` | Tab hasn't been selected since loading |
| `bursting` | `"true"` | Tab loading animation state |
| `had-zen-pinned-changed` | `"true"` | Pin state was modified |
| `zenDefaultUserContextId` | `"true"` | Uses default user context |
| `--zen-original-tab-icon` | (style attribute) | Original icon URL as CSS variable |

### Key Properties on Tab Objects

```js
tab.id               // DOM id string (e.g., "1773377568372-76")
tab.label             // Tab title
tab.image             // Favicon URL
tab.pinned            // Boolean
tab.selected          // Boolean (is this the active tab?)
tab.hidden            // Boolean (Zen doesn't use this for workspace hiding)
tab.lastAccessed      // Unix timestamp (ms) of last activation
tab.linkedBrowser     // The <browser> element for this tab
tab.openerTab         // Native tab element that opened this tab (or null)
tab.linkedBrowser.currentURI.spec  // Current URL
tab.linkedBrowser.browserId        // Browser ID (NOT the same as extension tab ID)
```

### Tab Inner DOM Structure

Each `.tabbrowser-tab` element has this internal structure:

```
.tabbrowser-tab                      ← overflow: clip (pseudo-elements get clipped!)
  └── stack.tab-stack                ← flex="1"
      ├── vbox.tab-background        ← border-radius: 12px, overflow: hidden
      │   ├── hbox.tab-context-line
      │   ├── hbox.tab-loading-burst
      │   └── hbox.tab-group-line
      └── hbox.tab-content           ← overflow: visible, position: relative
          ├── box.tab-reset-pin-button
          ├── stack.tab-icon-stack   ← contains favicon
          │   ├── hbox.tab-throbber
          │   ├── hbox.tab-icon-pending
          │   └── img.tab-icon-image ← the favicon
          ├── .tab-label-container   ← contains the tab title text
          ├── image.tab-close-button
          └── image.tab-reset-button
```

**CSS targeting gotchas:**

- The `.tabbrowser-tab` element has `overflow: clip` — `::after` pseudo-elements on the tab itself get clipped. Target `.tab-content` instead for overlays like indicator dots.
- Applying `filter` or `opacity` to the tab element affects ALL children including pseudo-elements. To dim unloaded tabs without affecting an indicator dot on `.tab-content`, target `.tab-icon-stack` and `.tab-label-container` individually.

---

## Content Area DOM

The web content area has this structure from the browser element up to the window:

```
browser                              ← GPU-composited, ignores parent CSS clips
  └── stack.browserStack             ← overflow: visible, position: relative
      └── vbox.browserContainer
          └── hbox.browserSidebarContainer  ← border-radius: 12px, overflow: clip
                                              box-shadow: 0 0 0 9.73px rgba(0,0,0,0.25)
              └── tabpanels#tabbrowser-tabpanels
                  └── tabbox#tabbrowser-tabbox
                      └── hbox#zen-tabbox-wrapper
                          └── vbox#zen-appcontent-wrapper
                              └── hbox#browser            ← background: none
                                  └── hbox#zen-main-app-wrapper  ← background: rgb(30,30,30)
```

### Corner Bleed Problem

`.browserSidebarContainer` has `border-radius: 12px; overflow: clip` to round the content area corners. However, the `<browser>` element is GPU-composited — it renders on a separate compositor surface that ignores parent CSS `overflow` clipping. This causes white corners to "bleed" through on pages with light backgrounds.

**Fix:** Apply `clip-path` which operates at the compositor level:

```css
html:not([sizemode="fullscreen"]) .browserStack,
html:not([sizemode="fullscreen"]) .browserStack > browser {
  clip-path: inset(0 round var(--zen-native-inner-radius)) !important;
}
```

**Note:** `clip-path` may have a minor performance cost since it forces the compositor to clip every frame. The shape is constant (not animated) so the GPU can cache it, but it's worth noting for lower-end hardware.

### Key CSS Variables

```css
--zen-native-inner-radius: max(5px, calc(16px - 8px / 2));  /* ~12px */
--zen-border-radius: 16px;
--zen-themed-toolbar-bg: /* varies by workspace theme */
```

---

## Split View DOM

When split view is active, Zen creates an overlay structure:

```
hbox#zen-splitview-overlay-wrapper
  └── hbox#zen-splitview-overlay     ← position: relative, pointer-events: none
      ├── div.zen-split-view-splitter  ← the resize handle between panes
      │                                  8px wide, position: absolute, cursor: ew-resize
      └── hbox#zen-splitview-dropzone
```

Each split pane's `.browserSidebarContainer` gets a header:

```
.browserSidebarContainer
  └── div.zen-view-splitter-header-container  ← position: absolute, top: -4.5px
      └── div.zen-view-splitter-header         ← display: flex
          ├── toolbarbutton.zen-tab-rearrange-button
          └── toolbarbutton.zen-tab-unsplit-button
```

### Header Hover Behavior

The header shows on hover of the parent `.browserSidebarContainer`:

- Default state: `opacity: 0`, `transition: opacity 0.1s`
- On `.browserSidebarContainer:hover`: `opacity: 1`
- Inactive panes: `visibility: hidden`

To show the header only when the cursor is near the top edge (instead of anywhere on the pane):

```css
.browserSidebarContainer .zen-view-splitter-header-container {
  opacity: 0 !important;
  transition: opacity 0.15s !important;
}
.zen-view-splitter-header-container:hover {
  opacity: 1 !important;
}
```

This overrides the pane-wide hover trigger at higher specificity, then the `:hover` on the container itself (which sits at the top of the pane) brings it back.

---

## gBrowser

The main tabbrowser object.

### Key Properties

```js
gBrowser.selectedTab          // Currently active native tab element
gBrowser.tabs                 // HTMLCollection of tabs in CURRENT WORKSPACE ONLY
gBrowser.tabContainer         // The tab container element
gBrowser.tabContainer.allTabs // Same as gBrowser.tabs (workspace-scoped)
```

### Key Methods

```js
gBrowser.getBrowserForTab(tab)  // Get the <browser> element for a tab
gBrowser.removeTab(tab)         // Close a tab
```

### Events

```js
gBrowser.tabContainer.addEventListener("TabSelect", (e) => {
  // Fires when ANY tab is activated, including workspace switches
  // e.target is the newly selected tab element
  console.log(e.target.label, e.target.getAttribute("zen-workspace-id"));
});
```

**Important:** `TabSelect` fires during workspace switches. When you switch workspaces, it fires for the tab Zen auto-selects in the target workspace.

---

## gZenSessionStore

Minimal — mostly delegates to `ZenSessionManager.sys.mjs`.

```js
Object.keys(gZenSessionStore)
// → ["_resolveInitialized", "promiseInitialized"]

Object.getOwnPropertyNames(Object.getPrototypeOf(gZenSessionStore))
  .filter(k => typeof gZenSessionStore[k] === 'function')
// → ["constructor", "init", "restoreInitialTabData"]
```

`ZenSessionManager` (referenced in console logs) is a JSM module, not a window global. It logs session saves:
```
ZenSessionManager: Saving Zen session data with 80 tabs
```

Session data is stored at:
```
<profile>/zen-sessions.jsonlz4
```

---

## gZenMods

The Zen Mods (CSS themes/customizations) system.

### Key Properties

```js
gZenMods.modsRootPath
// → "<profile>/chrome/zen-themes"

gZenMods.modsDataFile
// → "<profile>/zen-themes.json"
```

### Key Methods (18 total)

```js
Object.getOwnPropertyNames(Object.getPrototypeOf(gZenMods))
  .filter(k => typeof gZenMods[k] === 'function').sort()
// → ["checkForModChanges", "checkForModsUpdates", "constructor", "debounce",
//    "disableMod", "enableMod", "getModFolder", "getModPreferences", "getMods",
//    "init", "installMod", "isModInstalled", "removeMod", "requestMod",
//    "sanitizeModName", "throttle", "triggerModsUpdate", "updateMods"]
```

**`getMods()`** — Returns the mod registry from `zen-themes.json`.
```js
await gZenMods.getMods()
// → {
//   "f7c71d9a-...": {
//     id: "f7c71d9a-...",
//     name: "Better Unloaded Tabs",
//     description: "Makes unloaded tabs easier to notice...",
//     style: "https://raw.githubusercontent.com/.../chrome.css",
//     readme: "https://raw.githubusercontent.com/.../readme.md",
//     author: "Felkazz",
//     version: "1.0.1",
//     enabled: true
//   }
// }
```

**`installMod(mod)`** — Downloads CSS from `mod.style` URL into the mod folder. Does NOT support local file:// URLs — it calls `#downloadUrlToFile` internally.

**`isModInstalled(modId)`** — Checks `getMods()` for the given ID.

**`removeMod(modId)`** — Removes a mod from the registry and deletes its folder.

**`triggerModsUpdate()`** — Reloads all mod CSS. Call after modifying `zen-themes.json` or mod files programmatically.

**`getModFolder(modId)`** — Returns `PathUtils.join(modsRootPath, modId)`.

### Mod File Structure

Each mod is a folder inside `<profile>/chrome/zen-themes/`:

```
chrome/zen-themes/
├── <mod-id>/
│   ├── chrome.css         # The mod's CSS (required)
│   ├── readme.md          # Description (optional)
│   └── preferences.json   # User preferences (optional)
└── <another-mod-id>/
    └── chrome.css
```

The registry file `zen-themes.json` in the profile root maps mod IDs to metadata.

### Programmatic Mod Installation

Since `installMod()` requires URLs, local mods must be installed by writing files directly:

```js
let modId = "my-custom-mod";
let modFolder = PathUtils.join(gZenMods.modsRootPath, modId);
await IOUtils.makeDirectory(modFolder, { ignoreExisting: true });
await IOUtils.write(
  PathUtils.join(modFolder, "chrome.css"),
  new TextEncoder().encode(css)
);

let mods = await gZenMods.getMods();
mods[modId] = {
  id: modId,
  name: "My Custom Mod",
  description: "...",
  author: "...",
  version: "1.0.0",
  enabled: true,
};
await IOUtils.writeJSON(gZenMods.modsDataFile, mods);
gZenMods.triggerModsUpdate();
```

**Note:** When doing this from an Experiment API, `PathUtils`, `IOUtils`, and `TextEncoder` are not available in the experiment scope — access them from the window object: `w.PathUtils`, `w.IOUtils`, `new w.TextEncoder()`.

### Key Behaviors

- Mods are CSS-only, loaded into the browser chrome context
- Preferences defined in `preferences.json` are accessible via `@media (-moz-pref("pref.name", value))` in CSS
- Dot notation in pref names becomes hyphens in CSS: `mod.foo.bar` → `--mod-foo-bar`
- Mods can be submitted to `zen-browser/theme-store` GitHub repo
- The Zen Mods import dialog (`about:preferences#zenMarketplace`) opens a file picker, but imported mods are fetched from URLs — local-only mods must be installed programmatically

---

## SessionStore (Firefox)

```js
SessionStore.getTabState(gBrowser.selectedTab)
// → JSON string with full tab state including navigation history, scroll position, etc.

// getWindowState returns all window state but the format may not be standard JSON
SessionStore.getWindowState(window)
```

---

## Extension Integration

### Extension Popup Panel

When using `browser_action` popup, the panel element in chrome DOM is:
```
#customizationui-widget-panel
```

This is a **shared reusable panel** (not per-extension). The extension-specific part is identified by:
```
viewId="PanelUI-webext-zen-tabs-panel_c13v_com-BAV"
```

Extension ID mangling: `@` → `_`, `.` → `_`
So `zen-tabs-panel@c13v.com` → `zen-tabs-panel_c13v_com`

**Important:** The panel's position is controlled by XUL layout at the C++ level, not CSS. `position: fixed` on the panel moves content inside it but not the panel itself. This is why we use a custom chrome DOM overlay instead.

### Loading Extension Pages in Chrome Context

Regular `<iframe>` elements in chrome context cannot load `moz-extension://` URLs. You must use a XUL `<browser>` element:

```js
const br = document.createXULElement("browser");
br.setAttribute("type", "content");
br.setAttribute("remote", "true");
br.setAttribute("maychangeremoteness", "true");
br.setAttribute("disableglobalhistory", "true");
br.setAttribute("messagemanagergroup", "webext-browsers");
br.setAttribute("webextension-view-type", "popup");
br.setAttribute("src", "moz-extension://[uuid]/popup/popup.html");
```

### Extension Tab ID vs Native Tab

The extension tab ID (from `browser.tabs.query()`) is NOT the same as:
- `tab.id` (DOM id attribute, e.g., `"1773377568372-76"`)
- `tab.linkedBrowser.browserId` (browser ID, e.g., `8`)
- `tab.linkedBrowser.outerWindowID` (e.g., `46`)
- `tab.linkedBrowser.browsingContext.id` (e.g., `24`)

The extension tab manager maps its own IDs. For cross-workspace operations, use DOM IDs (`tab.id`) since they're stable and accessible via `document.getElementById()`.

### Experiment APIs

Requires `extensions.experiments.enabled = true` in `about:config`.

Experiment APIs run in chrome context with full access to all globals (`gBrowser`, `gZenWorkspaces`, `Services`, etc.). They can:
- Access `gBrowser.tabs` and all DOM elements
- Call `gZenWorkspaces.changeWorkspaceWithID()`
- Create/manipulate chrome DOM elements
- Listen to chrome events (`TabSelect`, etc.)

The `context.extension.tabManager` is subject to Zen's workspace filtering — `tabManager.get(tabId)` may fail for cross-workspace tabs. Use `document.getElementById(domId)` instead.

**Scope limitations:** The experiment parent scope (`getAPI()`) does NOT have standard web globals. These must be accessed from the window object:

| Missing global | Workaround |
|---|---|
| `PathUtils` | `w.PathUtils` (where `w = Services.wm.getMostRecentWindow(...)`) |
| `IOUtils` | `w.IOUtils` |
| `TextEncoder` | `new w.TextEncoder()` |
| `setTimeout` | `ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs")` or `w.setTimeout` |

**Lazy loading:** `getAPI()` only runs when the extension first accesses the experiment namespace (e.g., `browser.zenWorkspaces.someMethod()`). Code in `getAPI()` that should run on startup needs to be triggered by a call from `background.js`:

```js
// background.js — force experiment API to load on startup
browser.zenWorkspaces.getActiveWorkspaceId().catch(() => {});
```

**Caching:** Changes to `experiment/api.js` or `experiment/schema.json` require a full browser restart. Reloading from `about:debugging` does not pick up experiment changes.

### Signing

```js
AppConstants.MOZ_REQUIRE_SIGNING
// → false (Zen compiles without mandatory signing)
```

This means `xpinstall.signatures.required = false` in `about:config` allows permanent installation of unsigned extensions via "Install Add-on From File" in `about:addons`.

---

## Useful Patterns

### Query ALL tabs across all workspaces
```js
document.querySelectorAll(".tabbrowser-tab")
// Returns ALL tab elements regardless of workspace
```

### Activate a cross-workspace tab
```js
let tab = document.getElementById(domId);
let workspace = tab.getAttribute("zen-workspace-id");
if (workspace !== gZenWorkspaces.activeWorkspace) {
  await gZenWorkspaces.changeWorkspaceWithID(workspace);
}
gBrowser.selectedTab = tab;
```

### Get workspace icons as inline SVG
Workspace `icon` field is a `chrome://` URL (e.g., `chrome://browser/skin/zen-icons/selectable/egg.svg`). Extension content pages cannot load `chrome://` URLs. Fetch the SVG content in chrome context and pass it inline:
```js
const w = Services.wm.getMostRecentWindow("navigator:browser");
const resp = await w.fetch(workspace.icon);
const svgContent = await resp.text();
// Pass svgContent to popup, render with innerHTML
```

### Find tabs in the current split view
```js
let currentTab = gBrowser.selectedTab;
let group = gZenViewSplitter._data.find(
  g => g.tabs?.some(t => t.id === currentTab.id)
);
let siblingTabs = group?.tabs || [];
```

### Get the most recently used tab (excluding visible ones)
```js
let allTabs = Array.from(document.querySelectorAll(".tabbrowser-tab"));
let current = gBrowser.selectedTab;
let visibleIds = new Set([current.id]);

// Add split view siblings if applicable
let group = gZenViewSplitter._data?.find(g => g.tabs?.some(t => t.id === current.id));
if (group) group.tabs.forEach(t => visibleIds.add(t.id));

let prev = allTabs
  .filter(t => !visibleIds.has(t.id))
  .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
```

---

## Chrome CSS Gotchas

### CSS nesting doesn't work

Chrome stylesheets (userChrome.css, Zen Mods) do NOT support CSS nesting syntax. This is a common reason existing Zen Mods break:

```css
/* BROKEN — nesting not supported in chrome context */
html:not([sizemode="fullscreen"]) {
  .browserStack, browser {
    clip-path: inset(0 round var(--zen-native-inner-radius));
  }
}

/* WORKS — flat selectors */
html:not([sizemode="fullscreen"]) .browserStack,
html:not([sizemode="fullscreen"]) .browserStack > browser {
  clip-path: inset(0 round var(--zen-native-inner-radius)) !important;
}
```

### `!important` is usually required

Zen's own stylesheets load with high specificity. Mod CSS typically needs `!important` on all declarations to override them. Test without it first in Browser Toolbox, but expect to need it.

### `overflow: clip` on tab elements

The `.tabbrowser-tab` element has `overflow: clip` — any `::before` or `::after` pseudo-elements positioned outside its bounds are invisible. Target inner elements (`.tab-content`, `.tab-icon-stack`) instead.

### GPU-composited elements ignore CSS clips

The `<browser>` element (web content) is GPU-composited and ignores parent `overflow: clip/hidden` and `border-radius`. Use `clip-path` to clip at the compositor level.

---

## Profile Paths (macOS)

```
Profile root:  ~/Library/Application Support/zen/Profiles/<name>.Default (release)/
Session data:  <profile>/zen-sessions.jsonlz4
Chrome CSS:    <profile>/chrome/userChrome.css
Zen Mods:      <profile>/chrome/zen-themes/<mod-id>/chrome.css
Mod registry:  <profile>/zen-themes.json
Extensions:    <profile>/extensions/
```

App bundle: `/Applications/Zen.app/`
Bundle ID: `app.zen-browser.zen`

### Enterprise Policies (macOS)

Via managed preferences (outside app bundle, no code signing issues):
```bash
sudo defaults write /Library/Preferences/app.zen-browser.zen <key> <value>
```

Check active policies at `about:policies`.

**Note:** Policies can force-install extensions but only signed ones (`ERROR_SIGNEDSTATE_REQUIRED`). Since `MOZ_REQUIRE_SIGNING` is `false` in Zen, use `xpinstall.signatures.required = false` instead for unsigned extensions.
