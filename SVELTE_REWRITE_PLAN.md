# Popup rewrite: Svelte 5 + TypeScript + decoupled architecture

## Context

Three converging pressures shape this rewrite:

1. **The chord-replay race.** Today's popup view handlers entangle data fetching, state mutation, and DOM painting in a single async function. Concurrent `WarmRearm`s stomp each other's renders. The current band-aid is per-handler `if (ui.currentView !== "x") return;` guards after every `await`. Adding a view means remembering the guard.

2. **3000-tab performance.** Opening the menu in a 2000+ tab session visibly stutters today — the reveal animation hitches and content paints late. The cause is hot-path work: synchronous `browser.tabs.query()` + per-tab iteration during the reveal frame. Any new architecture must keep both the visible UI (reveal, view-switch animations) and the invisible chord-chain path snappy regardless of tab count.

3. **An opportunity.** Since the refactor already touches most of the popup, switching to Svelte 5 + TypeScript is cheap now and would meaningfully improve both maintainability and the testability story. The user has already chosen this path; the build step is acceptable.

End-state goals:

- **User-visible parity is mandatory.** From the user's perspective, the migrated extension must look identical and work identically. The rewrite changes internals only: every existing view, shortcut, animation, hover preview, sidebar behavior, row badge, feature, setting, companion-mod flow, and edge-case interaction remains implemented and visually unchanged unless a separate product decision explicitly changes it.
- **No hidden TODOs at handoff.** The migration is not complete until every user-visible feature is implemented, verified, and wired through the new architecture. Placeholder views, fake IDs, partial keyboard paths, TODO/FIXME comments in production migration code, "follow-up" gaps, and known parity exceptions are release blockers, not acceptable final state.
- **State / interaction / UI strictly decoupled.** State lives in `$state` stores; the pure interaction interpreter turns input into commands from the navigation tree; a thin runtime applies commands; Svelte components render. Components never fetch, never mutate state imperatively, never send IPCs, and never own keybinding semantics. The interpreter never touches DOM.
- **Hot-path work is bounded.** Per-tab iteration happens off-path in a chrome-authoritative tab-index owned by the Experiment API and exposed through cached typed background queries. Popup queries return precomputed, windowed data in <1ms.
- **Animations declarative.** Svelte `transition:` / `animate:flip` directives replace today's hand-rolled cross-fade and badge-reassignment dances.
- **Bug classes eliminated by typing.** TypeScript catches the "undefined state field," "wrong message shape," "missing case" issues at compile time.
- **Unit-testable.** Pure transition functions and the tab-index module run under Vitest without a browser. The decoupling makes this natural.

## Stack and tooling

- **Svelte 5** — runes-based reactivity (`$state`, `$derived`, `$effect`). One npm dep + plugin.
- **TypeScript** — strict mode. `.svelte` files use `<script lang="ts">`.
- **Vite** — build + dev server. `@sveltejs/vite-plugin-svelte`. No HMR for extensions (extension reload required), but fast incremental builds.
- **Vitest** — Vite-native test runner. Reuses the Vite config. `happy-dom` for component tests where DOM needed; pure-node for transitions/index/keyboard tests.
- **Build output**: `dist/` with `manifest.json`, `popup/popup.html`, `popup/popup.js`, `popup/popup.css`, `background.js`, `experiment/*` (passthrough chrome-scope assets), `icons/*`. Firefox loads `dist/` as the extension root.

`package.json` dev deps (~6 explicit): `svelte`, `@sveltejs/vite-plugin-svelte`, `vite`, `vitest`, `typescript`, `@types/firefox-webext-browser`, `happy-dom`. Transitive tree ~150 packages, dev-only, never ships.

## Architecture

Three strict layers in the popup, plus a hybrid tab-index pipeline, plus the unchanged-vanilla chord engine / overlay management. Each layer's contract is enforced by file location and TypeScript boundaries.

### Single navigation/action tree

Adding a feature must not require re-implementing keybinding logic in multiple places. The rewrite has one typed navigation/action tree, and every interaction path reads that tree:

- fast chord chains handled by the chrome/content chord engines,
- slow visible-menu key presses handled by the popup,
- bridge replay from `ZenChord:DeliverKey`,
- mouse/touch row activation,
- rendered badges/hints/arrows,
- replay recording.

The tree describes feature semantics, not DOM:

```ts
type NavNode =
  | {
      kind: "action";
      id: ActionId;
      chord: Chord;
      label: string;
      icon: IconId;
      availability?: AvailabilityPredicateId;
      effect: ActionEffectId;
    }
  | {
      kind: "view";
      id: ViewId;
      chord: Chord;
      label: string;
      icon: IconId;
      availability?: AvailabilityPredicateId;
      loader: ViewLoaderId;
    }
  | {
      kind: "prefix";
      id: ViewId;
      chord: Chord;
      label: string;
      icon: IconId;
      children: NavNode[];
    };
```

`src-svelte/shared/navigation-tree.ts` is the single source of truth for chord keys and menu structure. It replaces the current split-brain pattern where feature authors must remember to update `shared/keybindings.js`, popup keyboard handling, menu rendering, badges, replay, and edge-case bridge paths separately.

There are separate registries for implementation:

- `action-registry.ts` maps `ActionEffectId -> typed effect handler`.
- `view-registry.ts` maps `ViewLoaderId/ViewId -> typed data loader + Svelte view component`.
- `availability.ts` maps `AvailabilityPredicateId -> pure predicate over summary state`.

The tree never imports Svelte, DOM, `browser.*`, or mutable app state. Registries implement behavior behind typed IDs. TypeScript exhaustiveness checks should fail the build if a tree node references a missing action, view loader, availability predicate, or renderer.

### Interaction Interpreter

All user input flows through one interpreter in `src-svelte/popup/interaction/`:

```ts
interpretInput(input: InteractionInput, context: InteractionContext): InteractionResult
```

Inputs include keyboard keys, chord-bridge keys, action-row clicks, list-row clicks, sidebar controls, and replay requests. Results are declarative commands such as `NavigateToView`, `RunAction`, `MoveSelection`, `PageActions`, `GoBack`, `ClosePalette`, `RequestWindow`, or `Noop`. A small runtime applies those commands by mutating store state and sending typed IPC.

Important rule: view components do not decide what a key means, and they do not duplicate chord/menu semantics. They render rows from view models and emit semantic events like `{ kind: "row-activate", rowId }` or `{ kind: "sidebar-command", commandId }`. The interpreter resolves those events against the same tree/view model used for keyboard input.

This is the main correctness invariant for the migration:

- Adding an action means adding one tree node plus one `ActionEffectId` implementation.
- Adding a view means adding one tree node plus one loader/component pair.
- Adding a prefix submenu means adding one tree node with children.
- Badges, chord matching, visible-menu hotkeys, bridge replay, replay recording, and mouse activation update automatically from the tree and generic interpreter.
- A feature is not complete if it requires a second hard-coded key path outside the tree/interpreter.

### Lessons from the failed `svelte-rewrite` branch

The prior `svelte-rewrite` branch and its docs are useful negative references, not authorities. Treat every conclusion from that work as a hypothesis until confirmed against the current production code or live Zen. The branch had a plausible Svelte/TS skeleton, but it missed the migration's real success condition: production parity. The new migration must explicitly avoid these failure modes:

- **No placeholders or "phase later" user flows.** The failed branch left `duplicates`, `open-in-container`, `extension-popup`, visible-menu hotkeys, chord replay, filters/sorts, and 2D actions-menu navigation incomplete. A view is not considered ported until every vanilla behavior for that view works.
- **No generic view substitution.** The failed branch reused a generic all-tabs loader for sibling/parent/tabs-by-age/most-visited views, which made screens render but semantically wrong. Each view needs its own data contract and parity tests.
- **No fake action targets.** The failed branch sent placeholders such as `__index:0` for workspace and extension shortcuts. Digit actions must resolve through real row/action models before dispatch.
- **No visual drift from component CSS.** The failed branch copied `popup.css` but then added scoped component styles for `.list-item`, `button`, prompts, and virtual rows that changed the UI. Svelte components must emit vanilla-compatible DOM/class structure and rely on the existing global CSS unless a parity screenshot proves the scoped style is identical.
- **No background-only cross-workspace truth.** The failed branch's BG index still depended on `browser.tabs.*` events and repeated full `api.getAllTabs()` scans to resolve DOM ids. The new plan uses the hybrid experiment-authoritative index described below.
- **No "typed" escape hatches hiding missing design.** Avoid `as never`, broad `unknown as BaseViewData`, and permissive placeholder data shapes in production code paths. Types should force real view data and action handling to exist.
- **Unit tests are not enough.** The failed branch had many pure tests while normal user behavior still failed. Verification must include live keyboard/chord scenarios, visual comparison, and every user-visible feature.

### Interactive development requirement

The migration must use the running Zen debug instance as part of normal development, not just at the end. Use `python3 tools/firefox-eval.py '<js>'` against `127.0.0.1:6000` to inspect chrome state, verify overlay/chord/index behavior, gather console errors, and reload the extension after changes. It is acceptable to improve or replace `tools/firefox-eval.py` if a better debug helper is needed.

Required debug workflow:

- **Pre-migration debug preflight:** before implementation starts, confirm `firefox-eval.py` can reach `127.0.0.1:6000`, record current cross-workspace tab count, active workspace, overlay state, installed add-on IDs, and whether the production/dev extension is loaded.
- **Current live preflight, 2026-05-14:** Zen was reachable. Before temporary installation, neither `zen-tabs-panel@c13v.com` nor `zen-tabs-panel-svelte-dev@c13v.com` was loaded. Installing the repo directory with `AddonManager.installTemporaryAddon` succeeded; the extension then reported `state: "Startup: Complete"` and `backgroundState: "running"`. The live profile had 1041 `.tabbrowser-tab` elements across workspaces and an active workspace of `{4cd2dd72-73b7-4b03-b984-944100d79c53}`. The overlay existed as a hidden prerender (`visibility: hidden`, popup URL `popup/popup.html?theme=dark&inst=1&delay=350`).
- **Current live performance baseline, 2026-05-14:** a lean chrome-scope DOM scan of all 1041 tabs, mapped to compact records and JSON-serialized, had p50 ~1.5ms, p95 ~4.3ms, and produced ~194 KB. From the extension background, `browser.tabs.query({ currentWindow: true })` returned 466 tabs in ~26ms, while `browser.zenWorkspaces.getAllTabs()` returned all 1041 tabs in ~59ms and structured-cloned/serialized ~8.6 MB of rich records. This is a best-case measured session, not the target ceiling: real user sessions can exceed 3000 tabs. Consequence: chrome-side indexing is acceptable, but full rich snapshots must not be part of reveal, scroll, or ordinary view-render hot paths.
- **Before coding risky chrome behavior:** inspect the live state with `firefox-eval.py` (tabs, workspaces, overlay, extension state, frame-script generation, index contents).
- **After each meaningful slice:** build `dist/`, reload the dev extension, open/rearm the palette, and verify the changed path in the live browser.
- **Reload strategy is empirical, not assumed.** First create a small reload probe that stamps the loaded background, popup, and Experiment API code versions into the console/window and verifies which reload mechanism actually refreshes each scope in the current Zen build.
- **For `experiment/api.js` or schema changes:** use the lightest reload mechanism proven by the probe. If plain `AddonManager.reload()` refreshes chrome-scope code, use it; if it leaves stale state, fall back to disable+enable. Re-test this when Zen updates.
- **For popup/background-only changes:** plain reload is acceptable only when logs or version probes confirm the new code is running; otherwise use the proven fallback.
- **If initial temporary add-on installation cannot be automated from the debug connection:** ask the user to load `dist/manifest.json` once, then use debug-driven reloads afterward.
- **Use live diagnostics as deliverables:** console errors, overlay state, popup URL/inst, index version/counts, active view/state, and chord/replay traces should be checked before declaring a slice complete.

### Layer 1: State (`src-svelte/popup/store/`)

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

### Layer 2: Logic / transitions (`src-svelte/popup/interaction/`, `src-svelte/popup/transitions/`)

Pure TypeScript, no DOM, no Svelte imports. Two flavors:

- **`transitions/*.ts`** — pure functions, easy to test. `nextSelectionIndex(state, direction) → number`. `computeGridLayout(items, columnCount) → GridLayout`. `resolveChordReplay(state, key) → ReplayPlan`.
- **`interaction/interpreter.ts`** — the single input interpreter. It reads the navigation/action tree and current view model, calls pure transitions, and returns declarative commands. It contains the generic edge-case handling for fast/slow/bridge paths, visible-menu navigation, list-row activation, back/escape behavior, pagination, and replay recording.
- **`interaction/runtime.ts`** — applies interpreter commands by calling store mutators and typed IPC. This is the only popup logic layer allowed to send IPC effects.

```ts
// interaction/interpreter.ts
export function interpretInput(
  input: InteractionInput,
  ctx: InteractionContext
): InteractionCommand[] {
  if (input.kind === "key") {
    return interpretKeyFromTree(input, ctx);
  }
  if (input.kind === "row-activate") {
    return resolveRowActivation(input.rowId, ctx);
  }
  return [{ kind: "noop" }];
}
```

The interpreter is pure and unit-tested with fixture trees and fixture view models. The runtime is thin and tested with mocked store mutators / mocked IPC. Neither layer touches DOM. No view-specific file is allowed to contain hard-coded chord strings or duplicate "digit N means row N" logic.

### Layer 3: UI (`src-svelte/popup/views/*.svelte`, `src-svelte/popup/components/*.svelte`)

Svelte components. Each view is a single `.svelte` file:

```svelte
<!-- src-svelte/popup/views/Domains.svelte -->
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

Components **read** state via $derived. They **never** mutate state, **never** fetch, **never** send IPCs, and **never** decide key semantics. They render view models and emit semantic events to the interaction runtime. Badges/hints are rendered from tree/view-model metadata, not manually retyped in each component.

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

### Hybrid tab-index (`src-svelte/experiment/api.js` authoritative, `src-svelte/background/tab-index-cache.ts` facade)

Zen's normal WebExtension tab APIs are workspace-scoped, so the authoritative cross-workspace index must live in the Experiment API where chrome DOM and Zen internals are visible. Background remains the typed WebExtension-facing facade and may cache query results by index version, but it must not try to independently mirror truth from `browser.tabs.query()`.

Experiment-side live index, kept warm by chrome-scope tab lifecycle hooks (`TabOpen`, `TabClose`, `TabSelect`), workspace-change hooks where available, and a scoped `MutationObserver` for tab DOM attribute changes:

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

  async ensureStarted(): Promise<void> { ... }          // starts async warm build; does not block chord arm
  async ensureBuilt(): Promise<void> { ... }            // chunked idle/microtask loop
  getVersion(): number { ... }                          // increments on every index mutation
  getCounts(): Counts { ... }                           // O(1)
  getDomains(): DomainEntry[] { ... }                   // O(1) read of maintained list
  getDomainTabs(domain: string, range: Range): ViewWindow<TabRecord> // O(window)
  getRecent(range: Range): ViewWindow<TabRecord>       // O(window)
  getRowTarget(view: ViewId, slot: ActionSlot): RowTarget | null
  // chrome event / observer handlers maintain the index
  onTabCreated(tab: Tab): void { ... }
  onTabUpdated(id: number, changes: Tab.UpdateChangeInfo, tab: Tab): void { ... }
  onTabRemoved(id: number): void { ... }
  onTabMoved(id: number, info: { fromIndex: number; toIndex: number }): void { ... }
  onTabActivated(info: { tabId: number; previousTabId?: number }): void { ... }
}
```

The popup queries the index through typed background messages (`tab-index:get-summary`, `tab-index:get-view-window`, `tab-index:get-row-target`, etc.). Background forwards to the Experiment API and caches results keyed by `{ view, params, range, indexVersion }`. The popup receives only the rows needed for the current viewport plus overscan; the full 3000-tab sorted list is never cloned into the popup for ordinary rendering.

Record shape discipline matters as much as windowing. The current rich `getAllTabs()` payload was measured at ~8.6 MB for 1041 tabs in the live profile, largely because it includes every field needed by every legacy view. The new index API should expose view-specific row DTOs: compact summary/count DTOs for the actions menu, lightweight rows for virtualized lists, and richer detail DTOs only for views like `tab-info` that actually need them. Background caches should store these view/range DTOs keyed by `indexVersion`, not a full mirror of every rich `TabRecord`.

3000+ tab requirement: the normal menu experience must feel instant at 3000 tabs. That means summaries used by the actions view are maintained incrementally as O(1) reads; list views fetch only viewport windows; row activation resolves a stable row token or slot against the current `indexVersion` without asking the popup to hold the full list; and no ordinary UI action is allowed to structured-clone a payload whose size grows with total tab count unless it is an explicitly user-requested bulk operation.

Cold-start safety: background forces Experiment API startup as it does today, then calls `ensureIndexStarted()` immediately. Chord arm may call `ensureIndexStarted()` again but must not await a full build. If the index is still cold, the popup reveals the actions shell and fills counts/previews as windows become available rather than blocking reveal animation. For a 3000+ tab cold session, the fallback must still be interactive: no reveal waits for full index build, and visible rows may show a bounded loading state while the index catches up.

Drift mitigation: listeners and observers maintain incremental updates; the index can rebuild opportunistically on chrome-window focus and on a low-frequency interval. Rebuild increments `indexVersion`, causing background query caches to invalidate.

### Chord engine and overlay — unchanged

`shared/chord-engine.js` and the overlay/chord-bridge machinery in `experiment/api.js` stay vanilla JS. They run in chrome scope (chrome-privileged parent process / per-content-process frame script), where Svelte can't run anyway. Their chord interface to the popup is unchanged: they send `ZenChord:*` IPCs into background, which forwards to popup as today.

`experiment/api.js` does change for tab data: it becomes the owner of the chrome-authoritative tab index. This is a data-service refactor, not a chord-engine rewrite.

The popup-side chord-bridge logic moves into `src-svelte/popup/chord-bridge.ts` — a small TypeScript module that listens for chord-bridge IPCs, normalizes them into `InteractionInput`, and feeds the same interpreter used by visible keyboard and mouse activation. No synthetic `KeyboardEvent` dispatch into DOM, and no separate bridge-only keybinding path.

## Performance discipline

### Budget 1: hot path (<16ms)

The hot path is: chord arm → popup mounts (already pre-rendered) → first paint after reveal. Operations allowed on this path:

- Map lookups and small array slices in the experiment tab-index (sub-ms).
- IPC round-trip popup ↔ bg (~1-2ms).
- Svelte component reactivity (compiled bindings, fast).
- Compositor-only animations (`transform`, `opacity`).

Operations forbidden on this path:

- `browser.tabs.query()` calls for cross-workspace view data — replaced by experiment tab-index lookups.
- Synchronous iteration of >50 items — pushed to experiment init, idle rebuild, or incremental updates.
- Structured-cloning thousands of rich tab records into the popup — replaced by compact summary DTOs and windowed view-data queries. The live baseline showed today's `getAllTabs()` moving ~8.6 MB for 1041 tabs; that pattern must not survive the rewrite.
- Any operation whose latency or payload size is linear in total tab count during reveal, visible-menu keyboard handling, row activation, or scrolling. Linear work is allowed only in index warm/rebuild tasks that yield and never block the UI.
- Layout reads (`offsetHeight`, `getBoundingClientRect`) during the animation frame — Svelte handles measurement internally for `animate:flip`; we avoid manual measurement.

Instrumentation: `performance.mark("chord-arm")` at engine arm, `performance.mark("popup-first-paint")` after Svelte's `mounted` hook + one frame. `performance.measure` for dev-mode logging. Budget verified in tests.

### Budget 2: indexing (off any hot path)

Chrome tab lifecycle listeners and tab DOM observers fire on their own schedule (not during user input). The experiment index module maintains its maps incrementally — each event handler is bounded work (add/remove one tab, update affected sorted buckets). Initial build is chunked and yields between batches.

### Budget 3: rendering — virtualization

`VirtualList.svelte` (~100 LOC, custom): fixed row height, single scrolling container, overscan buffer of 5 rows, backed by windowed index queries. The component/runtime asks for `{ offset, limit }` windows as the viewport changes; it does not require the entire view array in popup memory. Implementation sketch:

```svelte
<!-- src-svelte/popup/components/VirtualList.svelte -->
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

Real scrollbar (no fake-scroll behavior), native smoothness, mounts only ~20-30 nodes and structured-clones only the requested window regardless of total tab count.

### Budget 5: panel-resize coupling (chrome ↔ popup height sync)

The popup lives inside a chrome-side `<browser>` element whose height must match the popup's content. Today, each submenu calls `measureNaturalHeight()` (reads `getBoundingClientRect` on every child + margins) and sends a resize IPC. Manual, easy to forget, fragile across font/image-load timing.

**Svelte replacement: one binding + one effect at the App root.**

```svelte
<!-- src-svelte/popup/App.svelte -->
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
// src-svelte/popup/transitions/__tests__/selection.test.ts
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

### Tab-index core (no browser DOM) — pure unit tests

```ts
// tests/tab-index-core.test.ts
import { TabIndexCore } from "../src-svelte/shared/tab-index-core";

test("adds tab on tabs.onCreated", () => {
  const idx = new TabIndexCore();
  idx.upsert({ domId: "tab-1", url: "https://a.com/p", ... });
  expect(idx.getDomains()).toEqual([{ name: "a.com", count: 1 }]);
});

test("removes tab on tabs.onRemoved", () => { ... });
test("domain grouping updates on tab URL change", () => { ... });
test("recent list maintained on onActivated", () => { ... });
test("buildPromise yields between chunks of 200", async () => { ... });
```

### Interaction interpreter (fixture tree + mocked runtime)

```ts
// src-svelte/popup/interaction/__tests__/interpreter.test.ts
import { interpretInput } from "../interpreter";

const tree = [
  { kind: "view", id: "domains", chord: "Q", label: "Domains", loader: "domains" },
  { kind: "action", id: "go-to-previous-tab", chord: "P", label: "Previous", effect: "go-to-previous-tab" },
];

test("same tree node drives visible key and row activation", () => {
  const ctx = fixtureContext({ tree, currentView: "actions" });
  expect(interpretInput({ kind: "key", key: "Q" }, ctx)).toEqual([
    { kind: "navigate-to-view", view: "domains" },
  ]);
  expect(interpretInput({ kind: "row-activate", nodeId: "domains" }, ctx)).toEqual([
    { kind: "navigate-to-view", view: "domains" },
  ]);
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
src-vanilla/                            # known-good current extension source
  manifest.json
  background.js
  experiment/
  popup/
  shared/
  lib/
  options/
  welcome/
  icons/

src-svelte/                             # Svelte migration source root
  manifest.json                         # same extension layout as vanilla
  background/
    background.ts                       # later replaces background.js
    tab-index-cache.ts
    duplicate-intercept.ts
    settings.ts
  popup/
    popup.html
    main.ts                             # mounts App.svelte
    App.svelte                          # router shell, view transitions
    chord-bridge.ts                     # chord IPC → InteractionInput
    ipc.ts                              # typed sendMessage wrapper
    store/
      state.svelte.ts                   # $state tree + mutators
      types.ts
    interaction/
      interpreter.ts                    # pure tree/view-model input interpreter
      runtime.ts                        # applies commands via store mutators + IPC
      inputs.ts                         # DOM/chord/mouse event normalization
    transitions/
    views/
    components/
    popup.css                           # global styles; component-scoped only when parity-proven
  shared/
    constants.ts
    navigation-tree.ts                  # single source of truth for chords/menu nodes
    action-registry.ts
    view-registry.ts
    availability.ts
    types.ts
  experiment/                           # chrome-scope assets, copied/built to dist as-is
    api.js
    tab-index.js
    chord-engine.js
    schema.json
    schema.d.ts

scripts/
  build-extension.mjs                   # chooses src-vanilla or src-svelte, writes dist/
dist/                                   # generated, ignored; Zen loads this root
tests/
vite.config.ts
svelte.config.js
tsconfig.json
package.json
```

`npm run build:vanilla` copies `src-vanilla/` into `dist/`. `npm run build:svelte` builds/copies `src-svelte/` into the same `dist/` layout. Firefox loads `dist/manifest.json` via `about:debugging`; switching variants is rebuild + reload, not a different installed add-on. `dist/` is disposable and must not be edited by hand.

## Migration phases (single PR target, but sequenced)

The user chose single-PR delivery. Within the PR, sequencing keeps the working tree buildable at every step:

0. **Behavior + docs audit** — generate a parity table from `src-vanilla/shared/keybindings.js`, `src-vanilla/shared/constants.js`, `src-vanilla/manifest.json`, current vanilla views, screenshots, and current CSS. Treat code as source of truth for behavior; update README mismatches (double-tap Cmd, Ctrl+Cmd, split key, vertical navigation keys, dev load path) after migration. This table is the parity contract: no user-visible behavior or visual detail may be dropped during the rewrite.
1. **Dual-source build setup** — keep `src-vanilla/` as the known-good source root and `src-svelte/` as the migration source root. `npm run build:vanilla` and `npm run build:svelte` both write to `dist/`; verify they initially produce byte-for-byte equivalent extension files.
2. **Svelte tooling setup** — add `vite.config.ts`, `tsconfig.json`, `svelte.config.js`, and dev dependencies. Keep `dist/` generated and ignored.
3. **Static passthrough** — copy `experiment/`, `icons/`, generate `schema.d.ts` from `schema.json`.
4. **Shared types + navigation tree** — in `src-svelte/shared/`, port `constants.js` → `constants.ts` and `keybindings.js` → `navigation-tree.ts`. Define `ViewId`, `ViewParams`, `IpcMessage`, `ViewWindow`, `ActionSlot`, `RowTarget`, `NavNode`, `ActionEffectId`, `ViewLoaderId`, and `AvailabilityPredicateId` discriminated unions in `shared/types.ts`.
5. **Experiment tab-index** — add chrome-authoritative `src-svelte/experiment/tab-index.js` and wire `api.js` methods (`ensureIndexStarted`, `getIndexVersion`, `getViewSummary`, `getViewWindow`, `getRowTarget`). Build is chunked, event/observer-maintained, and never awaited on chord arm.
6. **Background tab-index facade** — `background/tab-index-cache.ts` routes typed index queries to experiment and caches by index version. Unit tests pass.
7. **Background runtime** — `background/background.ts` routes IPC messages (existing chord IPCs + new tab-index queries). Keep duplicate-intercept + webRequest paths.
8. **Popup store** — `state.svelte.ts` with $state tree, mutators, loaded-window state, query status, and types. Unit tests pass.
9. **Action/view/availability registries** — implement registries referenced by the tree. Type checks fail for any node whose action, loader, predicate, or renderer is missing.
10. **Popup IPC + chord-bridge** — `ipc.ts` typed wrapper, `chord-bridge.ts` listens for bridge IPCs and normalizes them into `InteractionInput`.
11. **Transitions** — pure helpers in `transitions/` (selection, grid-layout, chord-replay, window math). Unit tests pass.
12. **Interaction interpreter + runtime** — `interaction/interpreter.ts` consumes the tree and view models; `interaction/runtime.ts` applies commands through store mutators + IPC. Unit tests cover fast chord, slow visible menu, bridge replay, mouse activation, list digits, pagination, back/escape, and replay with the same fixture tree.
13. **Components — shells first** — `App.svelte`, `Header.svelte`, `Sidebar.svelte`, `ListItem.svelte`, `Badge.svelte`, `VirtualList.svelte`. Smoke tests.
14. **Views — one by one, complete before moving on** — port each `popup/views/*.js` to a `.svelte` component. A view is complete only when its data shape, rendering, mouse interactions, keyboard shortcuts, hover preview, row badges, sidebar controls, empty/error states, close/restore behavior, and panel sizing match vanilla. No placeholder view, generic all-tabs substitute, or "follow-up" behavior gap may advance past this phase. Verify against the live extension after each (load `dist/` as temporary add-on, walk through that view). Order: ActionsMenu, Domains, LastVisited, then the rest.
15. **Reveal / animation** — App.svelte's `transition:fade` for view changes; verify smoothness in live extension.
16. **Chord-replay through state** — wire `recordChordKey` / `replayLastChord` through the new chord-bridge + interpreter/runtime. No synthetic KeyboardEvent dispatch.
17. **Settings page** — port `options/options.html` + `options.js` if time permits, OR keep vanilla and reference unchanged from manifest. Recommend keeping vanilla for now (low-touch, not race-prone).
18. **Delete old copied vanilla popup files from `src-svelte/`** — only after Svelte parity is verified. Keep `src-vanilla/` as the long-lived baseline until the migration is accepted.
19. **README + CLAUDE.md** — update README to match current code behavior and add "Popup architecture invariants" to CLAUDE.md.

## Critical files (new structure)

(See "Project layout" above for full tree. Highest-leverage files for review:)

- `src-svelte/popup/store/state.svelte.ts` — state shape + mutators (the source of truth).
- `src-svelte/shared/navigation-tree.ts` — single source of truth for menu/chord structure.
- `src-svelte/popup/interaction/interpreter.ts` — pure input interpreter shared by keyboard, chord bridge, replay, and mouse activation.
- `src-svelte/popup/interaction/runtime.ts` — command application via store mutators + typed IPC.
- `src-svelte/popup/transitions/*.ts` — all pure logic (most-tested).
- `src-svelte/experiment/tab-index.js` — perf-critical chrome-authoritative tab index.
- `src-svelte/background/tab-index-cache.ts` — typed cache/facade over experiment index queries.
- `src-svelte/popup/components/VirtualList.svelte` — perf-critical.
- `src-svelte/popup/App.svelte` — view routing + reveal animation.
- `vite.config.ts` — build orchestration.
- `tsconfig.json` — strict mode on; checks the layer-separation enforcement at compile time.

Tooling utilities to reuse / port:

- `escapeHtml`, `formatDomain`, etc. from `shared/dom-utils.js` → `shared/format.ts` (rename — these aren't "dom" utilities, they're string formatters).
- `renderBadge` → becomes `Badge.svelte` component.

## Verification

**Unit (vitest):**

1. `npm test` — all unit tests pass. Coverage targets: 100% on `transitions/`, 95%+ on `interaction/interpreter`, 90%+ on `interaction/runtime`, 90%+ on `tab-index`, 70%+ on store mutators, smoke tests on each view component.

**Race regression (the bugs this kills):**

2. `cmd+.,r,2` then `cmd+.,.` — consistently lands on the recent tab. Run 20× in a row.
3. `cmd+.,p` then `cmd+.,.` — consistently switches to previous tab.
4. `cmd+.,r,9` (out-of-range) then `cmd+.,.` — replays last *successful* action.
5. Duplicate-prompt opens via `cmd+click` on a duplicate — no leftover sidebar visible, no leftover page-indicator. (Structurally impossible since the prompt component is the only thing the template renders.)
6. With the menu visible, every displayed action hotkey fires the same action as the fast chord path; action-like submenus and list-view digit shortcuts are included.
7. For a fixture navigation tree, the same node activation is produced by: fast chord input, visible-menu key input, bridge-delivered key input, replay, and mouse row activation. This is a unit-test requirement, not only live testing.

**Performance (3000+ tabs):**

8. `performance.measure` between chord arm and popup first-paint after reveal — <16ms warm, <100ms cold (after extension reload).
9. `tab-index:get-view-window` for a 3000-tab view returns only viewport+overscan rows; no full-list structured clone on scroll or reveal. In the live 1041-tab profile, ordinary view-window responses should stay in the low-KB range, not resemble the current ~8.6 MB `getAllTabs()` payload.
10. Scroll a 3000-domain list in `cmd+.,q` view — 60fps maintained (no virtualizer jank).
11. `cmd+.,r,1` fast in 3000-tab session — tab activates within ~50ms of the second key.
12. Synthetic tab-index stress tests cover at least 3000 and 10000 records in Node, asserting O(1) summary reads, O(window) view-window reads, bounded row DTO sizes, and yielding during rebuild chunks.
13. Live performance checks must report response byte sizes for summary/window IPC. A 3000-tab run fails if opening or scrolling a normal view transfers a payload proportional to all tabs.

**No-regression walk (every view renders and behaves identically to today's vanilla version):**

14. `actions`, `domains`, `domain-tabs`, `last-visited`, `recently-closed`, `navigation`, `close-and-select`, `move-to-folder`, `move-to-workspace`, `open-in-container`, `profiles`, `duplicate-prompt`, `child-tabs`, `sibling-tabs`, `parent-tabs`, `unvisited`, `tabs-by-age`, `most-visited`, `tab-info`, `duplicates`, `reorder-tabs`, `split-view`.
15. Screenshot comparison of the main menu, representative list views, duplicate prompt, tab info, and compact submenus against the current UI. Use `debug-baselines/2026-05-14/` as a live human reference for spacing, sizing, typography, row structure, badges, icons, and clipping. Do not use live-session screenshots as naive pixel-perfect goldens against arbitrary browser state; tab titles, counts, history, workspaces, favicons, and duplicate groups are dynamic. Automated screenshot tests should render deterministic fixture data or mask dynamic regions.
16. No placeholder text, "not yet ported" screen, fake workspace/extension id, or generic all-tabs fallback remains in any user-reachable path.

**Architectural grep invariants:**

17. `grep -rn "if (state.currentView !==" src-svelte/popup/` → zero hits.
18. `grep -rnE "document\.|listEl|headerEl|sidebarEl" src-svelte/popup/interaction/ src-svelte/popup/transitions/ src-svelte/popup/store/` → zero hits.
19. `grep -rnE "sendIpc|ext\.runtime\.sendMessage|browser\.runtime\.sendMessage" src-svelte/popup/views/ src-svelte/popup/components/ src-svelte/popup/interaction/interpreter.ts` → zero hits.
20. `grep -rn "browser\.tabs\.query" src-svelte/popup/` → zero hits.
21. `grep -rnE "not yet ported|TODO|for now|__index:|as never|unknown as BaseViewData|generic all-tabs" src-svelte/` → zero hits in production paths.
22. `grep -rnE "chord:|hotkey:|key:\\s*[\"']|Shift\\+" src-svelte/popup/views/ src-svelte/popup/components/` → zero hits except test fixtures. View/components must render metadata from the tree/view model, not retype keybindings.
23. `grep -rnE "ActionEffectId|ViewLoaderId|AvailabilityPredicateId" src-svelte/shared/navigation-tree.ts src-svelte/shared/*registry* src-svelte/shared/availability.ts` plus `tsc --noEmit` proves every tree reference is implemented exactly once.

**Live debugging:**

24. `python3 tools/firefox-eval.py '<JS that inspects popup state>'` — state tree observable as a single object.
25. README keybinding and development instructions match `src-svelte/shared/navigation-tree.ts`, `src-svelte/manifest.json`, and the new `dist/` load path.

## Risk and rollback

**Risk 1 — Svelte/Vite for WebExtensions.** Svelte 5 in a content-process popup (loaded via `createXULElement("browser")` + `moz-extension://` URL) — should work, it's just JS + DOM. No Firefox-specific incompatibility expected, but verify on first build by loading the empty Svelte shell into a `<browser>` element. Mitigation: smoke-test step 1 confirms before any porting.

**Risk 2 — strict-mode TS friction.** Some experiment-API surfaces (`gZenWorkspaces`, `Services.*`) lack types. Mitigation: stub `.d.ts` files in `src-svelte/experiment/types.ts` declaring `any`-typed module shapes for chrome-scope APIs. The popup never imports these directly; bg/popup talk to chrome via typed IPC.

**Risk 3 — virtual list edge cases.** Selected-row-out-of-viewport when typing digit-1..9 in a scrolled list. Mitigation: `VirtualList` exposes `scrollToIndex(i)` method; selection mutator calls it when needed.

**Risk 4 — chord-engine ↔ popup integration regressions.** The chord-bridge IPC contract is unchanged, but the popup's listener moves from vanilla `keyboard.js` to `chord-bridge.ts`. Mitigation: integration test that simulates a `ZenChord:DeliverKey` arrival and asserts it produces the same interpreter command as the equivalent visible-menu key.

**Risk 5 — `ResizeObserver` in `moz-extension://` content process.** Standard DOM API, expected to work. Mitigation: smoke-test by binding `clientHeight` to a `<div>` and confirming it fires on resize during the initial empty-shell build step.

**Risk 6 — single-PR is large.** This is a rewrite of the popup. ~5000 LOC moves. Mitigation: phased *within* the PR — each commit (per step 1-16 above) keeps the build green and is independently revertable. The PR description has a per-commit walkthrough.

**Rollback:** `git revert <merge-commit>` returns to vanilla. State shape additive; no persistence migration. Tab-index module can be deleted standalone. Build config can be deleted standalone.
