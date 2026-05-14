# Zen Tabs Panel UI Baselines — 2026-05-14

These screenshots capture the current vanilla popup UI before the Svelte rewrite.

They were captured from the running Zen debug session using Firefox's privileged
`WindowGlobal.drawSnapshot(...)` API, not macOS `screencapture`. Files are saved
at 2x device-pixel scale for visual clarity.

## Capture Scope

- `main-menu.png`
- `reorder-tabs.png`
- `split-view.png`
- `close-and-select.png`
- `move-to-workspace.png`
- `move-to-folder.png`
- `open-in-container.png`
- `profiles.png`
- `domains.png`
- `last-visited.png`
- `recently-closed.png`
- `navigation.png`
- `child-tabs.png`
- `sibling-tabs.png`
- `parent-tabs.png`
- `unvisited-tabs.png`
- `tabs-by-age.png`
- `most-visited.png`
- `tab-info.png`
- `duplicates.png`
- `duplicate-prompt.png`

## Comparison Guidance

Do not use these live-session screenshots as naive pixel-perfect goldens against
an arbitrary future browser state. Tab titles, counts, history, duplicate groups,
workspace names, favicons, and enabled/disabled rows naturally depend on the
profile state.

Use them in two ways:

1. Human visual reference for spacing, typography, sizing, row structure,
   sidebars, badges, icons, headers, and prompt layout.
2. A source for fixture-backed automated tests: recreate equivalent view data in
   deterministic Svelte/component fixtures, then pixel-compare those deterministic
   renders with tolerances/masks for dynamic text and icons.

For live migration smoke tests, prefer assertions on:

- panel CSS width/height,
- rendered view title,
- expected row count or empty state,
- presence of key classes and badge/hotkey elements,
- no clipped text or 1x1/stale-main-menu captures,
- screenshot diff with dynamic regions masked or reviewed manually.

The capture harness should force a fresh overlay per view and wait for the popup
to report the expected view/title before snapshotting. Warm-popup rearm captures
can be misleading because stale content or stale dimensions may survive between
views.
