# Popup rewrite: Svelte 5 + TypeScript + decoupled architecture

## Context

Three converging pressures shape this rewrite:

1. **The chord-replay race.** Today's popup view handlers entangle data fetching, state mutation, and DOM painting in a single async function. Concurrent `WarmRearm`s stomp each other's renders. The current band-aid is per-handler `if (ui.currentView !== "x") return;` guards after every `await`. Adding a view means remembering the guard.

2. **3000-tab performance.** Opening the menu in a 2000+ tab session visibly stutters today — the reveal animation hitches and content paints late. The cause is hot-path work: synchronous `browser.tabs.query()` + per-tab iteration during the reveal frame. Any new architecture must keep both the visible UI (reveal, view-switch animations) and the invisible chord-chain path snappy regardless of tab count.

3. **An opportunity.** Since the refactor already touches most of the popup, switching to Svelte 5 + TypeScript is cheap now and would meaningfully improve both maintainability and the testability story. The user has already chosen this path; the build step is acceptable.

End-state goals:

- **State / logic / UI strictly decoupled.** State lives in `$state` stores; pure-TS handlers compute transitions; Svelte components render. Components never fetch, never mutate state imperatively, never send IPCs. Handlers never touch DOM.
- **Hot-path work is bounded.** Per-tab iteration happens off-path in a BG-resident tab-index, kept warm by `tabs.on*` listeners. Popup queries return precomputed data in <1ms.
- **Animations declarative.** Svelte `transition:` / `animate:flip` directives replace today's hand-rolled cross-fade and badge-reassignment dances.
- **Bug classes eliminated by typing.** TypeScript catches the "undefined state field," "wrong message shape," "missing case" issues at compile time.
- **Unit-testable.** Pure transition functions and the tab-index module run under Vitest without a browser. The decoupling makes this natural.

## Stack and tooling

- **Svelte 5** — runes-based reactivity (`$state`, `$derived`, `$effect`). One npm dep + plugin.
- **TypeScript** — strict mode. `.svelte` files use `<script lang="ts">`.
- **Vite** — build + dev server. `@sveltejs/vite-plugin-svelte`. No HMR for extensions (extension reload required), but fast incremental builds.
- **Vitest** — Vite-native test runner. Reuses the Vite config. `happy-dom` for component tests where DOM needed; pure-node for transitions/index/keyboard tests.
- **Build output**: `dist/` with `manifest.json`, `popup/popup.html`, `popup/popup.js`, `popup/popup.css`, `background.js`, `experiment/*` (copied unchanged), `icons/*`. Firefox loads `dist/` as the extension root.

`package.json` dev deps (~6 explicit): `svelte`, `@sveltejs/vite-plugin-svelte`, `vite`, `vitest`, `typescript`, `@types/firefox-webext-browser`, `happy-dom`. Transitive tree ~150 packages, dev-only, never ships.

## Architecture

Three strict layers in the popup, plus the BG tab-index, plus the unchanged-vanilla chord engine / experiment API. Each layer's contract is enforced by file location and TypeScript boundaries.

### Layer 1: State (`src/popup/store/`)

Single root state tree in `state.svelte.ts`:

```ts
export interface AppState {
  gen: number;                                  // bumps on every view transition
  currentView: ViewId;
  viewParams: ViewParams;
  navStack: NavFrame[];
  selectedIndex: number;
  visible: boolean;
  filter: string;
  dataByView: Partial<Record<ViewId, ViewData>>;
  gridLayout: GridLayout | null;
  workspaceFilter: string | "all";
  sidebarFocused: boolean;
  // ... etc.
}

export const state: AppState = $state({
  gen: 0,
  currentView: "actions",
  // ... defaults
});
```

State is exported as a single object. Components read fields directly (Svelte's $state tracking handles fine-grained reactivity per field). All mutations go through named functions also exported from this file:

```ts
export function setView(view: ViewId, params: ViewParams = {}): number {
  const myGen = ++state.gen;
  state.currentView = view;
  state.viewParams = params;
  state.selectedIndex = -1;
  return myGen;
}

export function recordFetch<V extends ViewId>(
  view: V,
  gen: number,
  data: ViewDataFor<V>
): void {
  if (gen !== state.gen) return;  // stale fetch, drop
  state.dataByView[view] = data;
}
```

**Rule**: only files in `store/` mutate `state` fields directly. Enforced by code review + a TS-side `Readonly<AppState>` re-export for consumers outside `store/`.

### Layer 2: Logic / transitions (`src/popup/keyboard/`, `src/popup/transitions/`)

Pure TypeScript, no DOM, no Svelte imports. Two flavors:

- **`transitions/*.ts`** — pure functions, easy to test. `nextSelectionIndex(state, direction) → number`. `computeGridLayout(items, columnCount) → GridLayout`. `resolveChordReplay(state, key) → ReplayPlan`.
- **`keyboard/handlers.ts`** — event handlers. They call pure transitions, then apply mutations via store functions, then dispatch IPC effects via a typed wrapper.

```ts
// keyboard/handlers.ts
import { state, setSelection } from "../store/state.svelte";
import { nextSelectionIndex } from "../transitions/selection";
import { sendIpc } from "../ipc";

export function handleListViewKey(key: string, mods: Modifiers): void {
  if (key === "ArrowDown") {
    setSelection(nextSelectionIndex(state, +1));
    return;
  }
  if (matchesDigit(key)) {
    const item = state.dataByView[state.currentView]?.items[digitOf(key) - 1];
    if (item) sendIpc({ type: "activate-tab", domId: item.domId });
    return;
  }
  // ...
}
```

Handlers ARE allowed to mutate state (via store mutators) AND fire IPCs. They are NOT allowed to touch DOM. Tests verify this by mocking `sendIpc` and asserting state shape after handler calls.

### Layer 3: UI (`src/popup/views/*.svelte`, `src/popup/components/*.svelte`)

Svelte components. Each view is a single `.svelte` file:

```svelte
<!-- src/popup/views/Domains.svelte -->
<script lang="ts">
  import { state } from "../store/state.svelte";
  import VirtualList from "../components/VirtualList.svelte";
  import ListItem from "../components/ListItem.svelte";

  const data = $derived(state.dataByView.domains);
</script>

<Header title="Domains" />

{#if data}
  <VirtualList items={data.domains} rowHeight={36} let:item let:index>
    <ListItem
      icon={item.faviconUrl}
      title={item.name}
      subtitle="{item.count} tabs"
      badge={index < 9 ? index + 1 : null}
      selected={state.selectedIndex === index}
    />
  </VirtualList>
{/if}
```

Components **read** state via $derived. They **never** mutate state, **never** fetch, **never** send IPCs. They emit DOM events that the runtime dispatches to handlers. Click handlers in components call functions imported from `keyboard/handlers.ts`.

Animations are declarative on the components:

```svelte
<div class="view-container" transition:fade={{ duration: 220 }}>
  ...
</div>

{#each tabs as tab (tab.domId)}
  <div animate:flip={{ duration: 200 }} transition:slide>
    <ListItem ... />
  </div>
{/each}
```

The current `runViewSwitchInvisibly` and `closeRowAndReindex` imperative dances are gone — replaced by Svelte transition directives.

### Background tab-index (`src/background/tab-index.ts`)

Live precomputed index, kept warm by `tabs.on*` listeners:

```ts
interface TabRecord { id: number; url: string; title: string; lastAccessed: number; ... }

class TabIndex {
  private byId = new Map<number, TabRecord>();
  private byDomain = new Map<string, number[]>();    // sorted by recency
  private byWorkspace = new Map<string, number[]>();
  private recentByLastAccessed: number[] = [];        // sorted desc
  private unvisited: number[] = [];
  private parentMap = new Map<number, number>();
  private childMap = new Map<number, number[]>();
  private generation = 0;
  private buildPromise: Promise<void> | null = null;

  async ensureBuilt(): Promise<void> { ... }            // chunked microtask loop
  getCounts(): Counts { ... }                           // O(1)
  getDomains(): DomainEntry[] { ... }                   // O(1) read of maintained list
  getDomainTabs(domain: string): TabRecord[] { ... }    // O(1) lookup
  getRecent(limit: number): TabRecord[] { ... }         // O(limit) slice
  // event handlers maintain the index
  onTabCreated(tab: Tab): void { ... }
  onTabUpdated(id: number, changes: Tab.UpdateChangeInfo, tab: Tab): void { ... }
  onTabRemoved(id: number): void { ... }
  onTabMoved(id: number, info: { fromIndex: number; toIndex: number }): void { ... }
  onTabActivated(info: { tabId: number; previousTabId?: number }): void { ... }
}
```

The popup queries the index via typed IPC messages (`tab-index:get-counts`, `tab-index:get-domains`, etc.). Each query is a Map lookup + Array slice — sub-millisecond. The full sorted list is returned (no pagination, no cursor); the popup's `VirtualList` mounts only visible rows.

Cold-start safety: `ensureBuilt()` builds the index in chunks of 200 tabs per microtask, yielding via `await Promise.resolve()` between chunks. The chord-arm pre-render gives 200-400ms head-start during the chord wait, masking cold-start cost. After warmup, refresh is incremental.

Drift mitigation: the index rebuilds on chrome-window focus AND on a ~60s interval. Listeners maintain incremental updates between rebuilds.

### Chord engine and experiment API — unchanged

`experiment/api.js` and `shared/chord-engine.js` stay vanilla JS. They run in chrome scope (chrome-privileged parent process / per-content-process frame script), where Svelte can't run anyway. Their interface to the popup is unchanged: they send `ZenChord:*` IPCs into background, which forwards to popup as today.

The popup-side chord-bridge logic moves into `src/popup/chord-bridge.ts` — a small TypeScript module that listens for chord-bridge IPCs and dispatches them as synthetic events into `keyboard/handlers.ts`. No synthetic `KeyboardEvent` dispatch into DOM — chord-replay re-feeds into handlers directly.

## Performance discipline

### Budget 1: hot path (<16ms)

The hot path is: chord arm → popup mounts (already pre-rendered) → first paint after reveal. Operations allowed on this path:

- Map lookups, array slices in the tab-index (sub-ms).
- IPC round-trip popup ↔ bg (~1-2ms).
- Svelte component reactivity (compiled bindings, fast).
- Compositor-only animations (`transform`, `opacity`).

Operations forbidden on this path:

- `browser.tabs.query()` calls — replaced by tab-index lookups.
- Synchronous iteration of >50 items — pushed to BG init or to incremental updates.
- Layout reads (`offsetHeight`, `getBoundingClientRect`) during the animation frame — Svelte handles measurement internally for `animate:flip`; we avoid manual measurement.

Instrumentation: `performance.mark("chord-arm")` at engine arm, `performance.mark("popup-first-paint")` after Svelte's `mounted` hook + one frame. `performance.measure` for dev-mode logging. Budget verified in tests.

### Budget 2: indexing (off any hot path)

`tabs.on*` listeners fire on their own schedule (not during user input). The index module maintains its maps incrementally — each event handler is bounded work (add/remove one tab, splice one array). Initial build is chunked-microtask-yielded.

### Budget 3: rendering — virtualization

`VirtualList.svelte` (~80 LOC, custom): fixed row height, single scrolling container, overscan buffer of 5 rows. Implementation sketch:

```svelte
<!-- src/popup/components/VirtualList.svelte -->
<script lang="ts" generics="T">
  type Props = {
    items: T[];
    rowHeight: number;
    overscan?: number;
    children: Snippet<[{ item: T; index: number }]>;
  };
  let { items, rowHeight, overscan = 5, children }: Props = $props();
  let container: HTMLDivElement;
  let scrollTop = $state(0);
  let viewportH = $state(0);

  const startIndex = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const endIndex = $derived(Math.min(items.length, Math.ceil((scrollTop + viewportH) / rowHeight) + overscan));
  const totalHeight = $derived(items.length * rowHeight);
  const visible = $derived(items.slice(startIndex, endIndex));
</script>

<div
  bind:this={container}
  bind:clientHeight={viewportH}
  onscroll={(e) => scrollTop = e.currentTarget.scrollTop}
  class="virtual-scroll"
>
  <div class="virtual-spacer" style:height="{totalHeight}px">
    {#each visible as item, i (startIndex + i)}
      <div class="virtual-row" style:transform="translateY({(startIndex + i) * rowHeight}px)">
        {@render children({ item, index: startIndex + i })}
      </div>
    {/each}
  </div>
</div>
```

Real scrollbar (no fake-scroll behavior), native smoothness, mounts only ~20-30 nodes regardless of `items.length`.

### Budget 5: panel-resize coupling (chrome ↔ popup height sync)

The popup lives inside a chrome-side `<browser>` element whose height must match the popup's content. Today, each submenu calls `measureNaturalHeight()` (reads `getBoundingClientRect` on every child + margins) and sends a resize IPC. Manual, easy to forget, fragile across font/image-load timing.

**Svelte replacement: one binding + one effect at the App root.**

```svelte
<!-- src/popup/App.svelte -->
<script lang="ts">
  let contentHeight = $state(0);
  let resizeRafId: number | null = null;

  $effect(() => {
    const h = contentHeight;
    if (h <= 0 || !state.visible) return;
    if (resizeRafId) cancelAnimationFrame(resizeRafId);
    resizeRafId = requestAnimationFrame(() => {
      sendIpc({ type: "panel-resize", height: h });
      resizeRafId = null;
    });
  });
</script>

<div bind:clientHeight={contentHeight} class="popup-root">
  <!-- view content -->
</div>
```

`bind:clientHeight` uses `ResizeObserver` under the hood — fires reactively on every content change (view switch, list grow/shrink, sidebar toggle, font/image load). Per-view height-measurement code is deleted. The `requestAnimationFrame` debounce caps the IPC rate at one per frame during animations (`animate:flip`, list reorder).

For view-switch cross-fades (View A → View B with different heights), Option A: let `clientHeight` drive resize as A unmounts and B mounts — one-frame lag is imperceptible at 60fps. Option B: pre-measure B's `clientHeight` in a hidden offscreen mount before unmount-fade, so chrome's panel-resize animation runs concurrently with the opacity cross-fade. Start with Option A; only escalate to B if jank is observed.

### Budget 4: animation frame integrity

Svelte transitions use `transform` and `opacity` by default — compositor-only, no layout reflow. `transition:fade` between views runs on the GPU. `animate:flip` measures positions via `getBoundingClientRect` once per change (Svelte's FLIP implementation, optimized).

State changes during a running transition are queued in $state but DOM updates batch via Svelte's microtask scheduler — they don't compete with the animation frame.

For chord-chain-with-invisible-popup: `state.visible === false`, the root `App.svelte` renders a hidden container (or `display: none`), so no transitions run. Pure state advances at memory speed.

## Testability and unit tests

Testing is the load-bearing argument for the architecture. Each layer is independently testable:

### Pure transitions (no DOM, no Svelte) — `vitest run --environment node`

```ts
// src/popup/transitions/__tests__/selection.test.ts
import { nextSelectionIndex } from "../selection";

test("ArrowDown advances within bounds", () => {
  const state = { selectedIndex: 0, items: [1, 2, 3] };
  expect(nextSelectionIndex(state, +1)).toBe(1);
});

test("ArrowDown at end wraps to 0", () => {
  const state = { selectedIndex: 2, items: [1, 2, 3] };
  expect(nextSelectionIndex(state, +1)).toBe(0);
});
```

### Tab-index (no DOM) — pure unit tests

```ts
// src/background/__tests__/tab-index.test.ts
import { TabIndex } from "../tab-index";

test("adds tab on tabs.onCreated", () => {
  const idx = new TabIndex();
  idx.onTabCreated({ id: 1, url: "https://a.com/p", ... });
  expect(idx.getDomains()).toEqual([{ name: "a.com", count: 1 }]);
});

test("removes tab on tabs.onRemoved", () => { ... });
test("domain grouping updates on tab URL change", () => { ... });
test("recent list maintained on onActivated", () => { ... });
test("buildPromise yields between chunks of 200", async () => { ... });
```

### Keyboard handlers (state + mocked IPC)

```ts
// src/popup/keyboard/__tests__/handlers.test.ts
import { handleListViewKey } from "../handlers";
import * as ipc from "../../ipc";

vi.mock("../../ipc");

test("digit-1 activates first item", () => {
  state.currentView = "domains";
  state.dataByView.domains = { domains: [{ name: "a.com", topId: "tab-7" }] };
  handleListViewKey("1", {});
  expect(ipc.sendIpc).toHaveBeenCalledWith({ type: "activate-tab", domId: "tab-7" });
});
```

### Store mutators

```ts
test("setView bumps gen", () => {
  const before = state.gen;
  setView("domains");
  expect(state.gen).toBe(before + 1);
  expect(state.currentView).toBe("domains");
});

test("recordFetch drops stale gen", () => {
  setView("domains");      // gen=N
  const staleGen = state.gen - 1;
  recordFetch("domains", staleGen, { domains: [{ name: "stale" }] });
  expect(state.dataByView.domains).toBeUndefined();
});
```

### Chord-replay

```ts
test("cmd+.,r,2 records and replays", () => {
  // simulate the chord chain
  recordChordKey("r");
  recordChordKey("2");
  commitChordAction("activate-tab", { domId: "tab-7" });
  // assert replay state
  const replay = getLastChordReplay();
  expect(replay).toEqual({ kind: "open-view", keys: ["r", "2"] });
});
```

### Component smoke tests (happy-dom)

```ts
test("Domains view renders list from state", async () => {
  state.currentView = "domains";
  state.dataByView.domains = { domains: [{ name: "a.com", count: 5 }] };
  const { container } = render(Domains);
  expect(container.querySelector(".list-item")?.textContent).toContain("a.com");
});
```

### What's NOT unit-tested

- The actual chord engine in `experiment/`: chrome-privileged frame-script, validated only via live debugging.
- The reveal cross-fade visually: smoke-tested for "transition runs" but human eye verifies smoothness.
- IPC over real `browser.runtime.sendMessage`: end-to-end in the live extension.

CI not in scope yet (user hasn't asked); `npm test` runs locally.

## Project layout

```
src/
  popup/
    popup.html                          # entry HTML
    main.ts                             # mounts App.svelte
    App.svelte                          # router shell, view transitions
    chord-bridge.ts                     # chord IPC → handlers
    ipc.ts                              # typed sendMessage wrapper
    store/
      state.svelte.ts                   # $state tree + mutators
      types.ts
    keyboard/
      handlers.ts                       # event handlers (mutates state, fires IPCs)
      key-map.ts                        # KEY_HANDLERS table
    transitions/                        # pure helpers (testable)
      selection.ts
      grid-layout.ts
      chord-replay.ts
    views/
      ActionsMenu.svelte
      Domains.svelte
      DomainTabs.svelte
      LastVisited.svelte
      RecentlyClosed.svelte
      Navigation.svelte
      CloseAndSelect.svelte
      MoveToFolder.svelte
      MoveToWorkspace.svelte
      OpenInContainer.svelte
      Profiles.svelte
      DuplicatePrompt.svelte
      ChildTabs.svelte
      SiblingTabs.svelte
      ParentTabs.svelte
      Unvisited.svelte
      TabsByAge.svelte
      MostVisited.svelte
      TabInfo.svelte
      Duplicates.svelte
      ReorderTabs.svelte
      SplitView.svelte
    components/
      Header.svelte
      Sidebar.svelte
      PageIndicator.svelte
      ListItem.svelte
      Badge.svelte
      VirtualList.svelte
    popup.css                           # global styles; component-scoped where possible
  background/
    background.ts                       # message router, chord routing, settings push
    tab-index.ts                        # live precomputed index
    duplicate-intercept.ts              # webRequest-based intercept
    settings.ts                         # storage.local wrapper, typed
  shared/
    constants.ts
    keybindings.ts
    types.ts                            # ViewId, ViewParams, IPC message union
  experiment/                           # unchanged, copied to dist as-is
    api.js
    chord-engine.js
    schema.json
    schema.d.ts                         # generated from schema.json (build step)
tests/                                  # alongside src/, vitest auto-discovers __tests__/
manifest.json                           # at repo root or src/static/, copied to dist
icons/                                  # copied to dist
vite.config.ts
svelte.config.js
tsconfig.json
package.json
```

Build outputs `dist/manifest.json`, `dist/popup/popup.html`, `dist/popup/popup.js`, `dist/popup/popup.css`, `dist/background.js`, `dist/experiment/*` (passthrough copy), `dist/icons/*`. Firefox loads `dist/` via `about:debugging`.

## Migration phases (single PR target, but sequenced)

The user chose single-PR delivery. Within the PR, sequencing keeps the working tree buildable at every step:

1. **Build setup** — `package.json`, `vite.config.ts`, `tsconfig.json`, `svelte.config.js`. Verify `npm run build` produces an empty `dist/` with manifest.
2. **Static passthrough** — copy `experiment/`, `icons/`, generate `schema.d.ts` from `schema.json`.
3. **Shared types** — port `shared/constants.js` → `constants.ts`, `keybindings.js` → `keybindings.ts`. Define `ViewId`, `ViewParams`, `IpcMessage` discriminated unions in `shared/types.ts`.
4. **Background tab-index** — `background/tab-index.ts` with listeners + chunked init. Unit tests pass.
5. **Background runtime** — `background/background.ts` routes IPC messages (existing chord IPCs + new tab-index queries). Keep duplicate-intercept + webRequest paths.
6. **Popup store** — `state.svelte.ts` with $state tree, mutators, types. Unit tests pass.
7. **Popup IPC + chord-bridge** — `ipc.ts` typed wrapper, `chord-bridge.ts` listens for bridge IPCs and dispatches into handlers.
8. **Transitions** — pure helpers in `transitions/` (selection, grid-layout, chord-replay). Unit tests pass.
9. **Keyboard handlers** — `keyboard/handlers.ts` calls transitions + mutators + ipc. Unit tests pass (with mocked ipc).
10. **Components — shells first** — `App.svelte`, `Header.svelte`, `Sidebar.svelte`, `ListItem.svelte`, `Badge.svelte`, `VirtualList.svelte`. Smoke tests.
11. **Views — one by one** — port each `popup/views/*.js` to a `.svelte` component. Verify against the live extension after each (load `dist/` as temporary add-on, walk through that view). Order: ActionsMenu, Domains, LastVisited, then the rest.
12. **Reveal / animation** — App.svelte's `transition:fade` for view changes; verify smoothness in live extension.
13. **Chord-replay through state** — wire `recordChordKey` / `replayLastChord` through the new chord-bridge + handlers. No synthetic KeyboardEvent dispatch.
14. **Settings page** — port `options/options.html` + `options.js` if time permits, OR keep vanilla and reference unchanged from manifest. Recommend keeping vanilla for now (low-touch, not race-prone).
15. **Delete old popup files** — once parity is verified.
16. **CLAUDE.md** — add "Popup architecture invariants" section codifying the layer rules and TypeScript boundaries.

## Critical files (new structure)

(See "Project layout" above for full tree. Highest-leverage files for review:)

- `src/popup/store/state.svelte.ts` — state shape + mutators (the source of truth).
- `src/popup/keyboard/handlers.ts` — all event handling.
- `src/popup/transitions/*.ts` — all pure logic (most-tested).
- `src/background/tab-index.ts` — perf-critical, most-tested.
- `src/popup/components/VirtualList.svelte` — perf-critical.
- `src/popup/App.svelte` — view routing + reveal animation.
- `vite.config.ts` — build orchestration.
- `tsconfig.json` — strict mode on; checks the layer-separation enforcement at compile time.

Tooling utilities to reuse / port:

- `escapeHtml`, `formatDomain`, etc. from `shared/dom-utils.js` → `shared/format.ts` (rename — these aren't "dom" utilities, they're string formatters).
- `renderBadge` → becomes `Badge.svelte` component.

## Verification

**Unit (vitest):**

1. `npm test` — all unit tests pass. Coverage targets: 100% on `transitions/`, 90%+ on `keyboard/handlers`, 90%+ on `tab-index`, 70%+ on store mutators, smoke tests on each view component.

**Race regression (the bugs this kills):**

2. `cmd+.,r,2` then `cmd+.,.` — consistently lands on the recent tab. Run 20× in a row.
3. `cmd+.,p` then `cmd+.,.` — consistently switches to previous tab.
4. `cmd+.,r,9` (out-of-range) then `cmd+.,.` — replays last *successful* action.
5. Duplicate-prompt opens via `cmd+click` on a duplicate — no leftover sidebar visible, no leftover page-indicator. (Structurally impossible since the prompt component is the only thing the template renders.)

**Performance (3000+ tabs):**

6. `performance.measure` between chord arm and popup first-paint after reveal — <16ms warm, <100ms cold (after extension reload).
7. Scroll a 3000-domain list in `cmd+.,q` view — 60fps maintained (no virtualizer jank).
8. `cmd+.,r,1` fast in 3000-tab session — tab activates within ~50ms of the second key.

**No-regression walk (every view renders identically to today's vanilla version):**

9. `actions`, `domains`, `domain-tabs`, `last-visited`, `recently-closed`, `navigation`, `close-and-select`, `move-to-folder`, `move-to-workspace`, `open-in-container`, `profiles`, `duplicate-prompt`, `child-tabs`, `sibling-tabs`, `parent-tabs`, `unvisited`, `tabs-by-age`, `most-visited`, `tab-info`, `duplicates`, `reorder-tabs`, `split-view`.

**Architectural grep invariants:**

10. `grep -rn "if (state.currentView !==" src/popup/` → zero hits.
11. `grep -rnE "document\.|listEl|headerEl|sidebarEl" src/popup/keyboard/ src/popup/transitions/ src/popup/store/` → zero hits.
12. `grep -rnE "sendIpc|ext\.runtime\.sendMessage|browser\.runtime\.sendMessage" src/popup/views/ src/popup/components/` → zero hits.
13. `grep -rn "browser\.tabs\.query" src/popup/` → zero hits.

**Live debugging:**

14. `python3 tools/firefox-eval.py '<JS that inspects popup state>'` — state tree observable as a single object.

## Risk and rollback

**Risk 1 — Svelte/Vite for WebExtensions.** Svelte 5 in a content-process popup (loaded via `createXULElement("browser")` + `moz-extension://` URL) — should work, it's just JS + DOM. No Firefox-specific incompatibility expected, but verify on first build by loading the empty Svelte shell into a `<browser>` element. Mitigation: smoke-test step 1 confirms before any porting.

**Risk 2 — strict-mode TS friction.** Some experiment-API surfaces (`gZenWorkspaces`, `Services.*`) lack types. Mitigation: stub `.d.ts` files in `src/experiment/types.ts` declaring `any`-typed module shapes for chrome-scope APIs. The popup never imports these directly; bg/popup talk to chrome via typed IPC.

**Risk 3 — virtual list edge cases.** Selected-row-out-of-viewport when typing digit-1..9 in a scrolled list. Mitigation: `VirtualList` exposes `scrollToIndex(i)` method; selection mutator calls it when needed.

**Risk 4 — chord-engine ↔ popup integration regressions.** The chord-bridge IPC contract is unchanged, but the popup's listener moves from vanilla `keyboard.js` to `chord-bridge.ts`. Mitigation: integration test that simulates a `ZenChord:DeliverKey` arrival and asserts the handler fires.

**Risk 5 — `ResizeObserver` in `moz-extension://` content process.** Standard DOM API, expected to work. Mitigation: smoke-test by binding `clientHeight` to a `<div>` and confirming it fires on resize during the initial empty-shell build step.

**Risk 6 — single-PR is large.** This is a rewrite of the popup. ~5000 LOC moves. Mitigation: phased *within* the PR — each commit (per step 1-16 above) keeps the build green and is independently revertable. The PR description has a per-commit walkthrough.

**Rollback:** `git revert <merge-commit>` returns to vanilla. State shape additive; no persistence migration. Tab-index module can be deleted standalone. Build config can be deleted standalone.
