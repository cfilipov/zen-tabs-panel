# Keybinding Conflicts on macOS

## Background

This extension uses `Ctrl+Cmd` (`MacCtrl+Command` in Firefox manifest syntax) as the modifier for all global keyboard shortcuts. Some `Ctrl+Cmd+letter` combinations conflict with macOS system shortcuts and cannot be used.

Firefox's `commands` API limits shortcuts to two modifiers + a key, so `Ctrl+Cmd+Shift+key` combinations are not possible.

## Why Ctrl+Cmd?

Previous iterations used `Ctrl+Option` (`MacCtrl+Alt`), but this had two problems:

1. **Firefox keyset conflicts** - Firefox registers browser shortcuts via `<key>` elements with `accel,alt` modifiers. On macOS, Firefox's key matching intercepts `Ctrl+Option` combinations for these keys, consuming the event before the extension command fires. Affected keys: I, E, U, N, and many others.

2. **Terminal emulator conflicts** - Browser-based terminal emulators (xterm.js, ttyd) consume all `Ctrl+Option` key combinations as terminal escape sequences, making the extension shortcuts unusable when a terminal tab has focus.

`Ctrl+Cmd` avoids both issues - Firefox has no built-in `Ctrl+Cmd` shortcuts, and terminal emulators don't intercept Cmd-based combinations.

## macOS system conflicts (cannot use with Ctrl+Cmd)

| Key | macOS action |
|-----|-------------|
| `D` | Dictionary lookup |
| `F` | Toggle fullscreen |
| `Q` | Lock Screen |

## Workaround

Actions whose natural mnemonic key conflicts with macOS are reassigned:
- Duplicates: `D` -> `K`
- Scroll to tab: `F` -> `L` (locate)
- Domains: `Q` -> `H` (hosts)

## All confirmed working keys with Ctrl+Cmd

`B`, `C`, `E`, `H`, `I`, `J`, `K`, `L`, `M`, `N`, `O`, `P`, `R`, `S`, `T`, `U`, `V`, `Period`
