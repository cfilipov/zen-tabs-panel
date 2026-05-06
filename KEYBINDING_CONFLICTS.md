# Keybinding Conflicts on macOS

## Background

This extension uses `Ctrl+Option` (`MacCtrl+Alt` in Firefox manifest syntax) as the modifier for all global keyboard shortcuts. Some `Ctrl+Option+letter` combinations conflict with Firefox/Zen built-in shortcuts and cannot be used.

## How conflicts work

Firefox registers browser shortcuts via `<key>` elements in `<keyset>` with `accel,alt` modifiers. On macOS, `accel` maps to `Cmd`, but Firefox's key matching also intercepts `Ctrl+Option` combinations for these same keys — consuming the event before the extension command fires.

Additionally, Firefox's `commands` API limits shortcuts to two modifiers + a key, so `Ctrl+Option+Shift+key` combinations are not possible.

## Conflicting keys (cannot use with Ctrl+Option)

| Key | Firefox/Zen binding | ID |
|-----|--------------------|----|
| `I` | Toggle DevTools Toolbox | `key_toggleToolbox` |
| `E` | Network Monitor | `key_netmonitor` |
| `U` | View Page Source / Zen Split Unsplit | `key_viewSourceSafari` / `zen-split-view-unsplit` |
| `N` | (macOS-level conflict) | — |
| `M` | Responsive Design Mode | `key_responsiveDesignMode` |
| `R` | Reader View | `key_toggleReaderMode` |
| `F` | Search / Find | `key_search2` |
| `G` | Zen Split View Grid | `zen-split-view-grid` |
| `H` | Hide Other Apps (macOS) | `key_hideOtherAppsCmdMac` |
| `K` | Web Console | `key_webconsole` |
| `L` | Inspector | `key_inspector` |
| `V` | Zen Split View Vertical | `zen-split-view-vertical` |
| `W` | DOM Inspector | `key_dom` |
| `Z` | JS Debugger | `key_jsdebugger` |

## Working keys (confirmed free)

`A`, `B`, `C`, `D`, `J`, `O`, `P`, `Q`, `S`, `T`, `X`, `Y`, `Space`

## Keys that conflict but still work via manifest commands

Some keys appear in the conflict list but work anyway because the extension command takes priority in practice: `C`, `D`, `M`, `R`, `F`, `S`. This is inconsistent — some `accel,alt` keyset entries block extension commands while others don't (possibly depending on whether they have an active `command` attribute).

## Workaround

Actions whose natural mnemonic key conflicts are reassigned to a free letter:
- New tabs: `N` → `A`
- Tab info: `I` → `T`
- Move to end: `E` → `B` (bottom)
- Unload: `U` → `X`
