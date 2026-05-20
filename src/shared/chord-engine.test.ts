import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type ChordEngineScope = {
  buildChordTree: (bindings: unknown[], workspaceChords: string[], constants: ChordConstants) => ChordTree;
  chordKeyFor: (event: EventLike) => string | null;
  createChordEngine: (opts: EngineOptions) => ChordEngine;
};

type ChordConstants = {
  CHORD_ROOT_TIMEOUT_MS: number;
  CHORD_PREFIX_TIMEOUT_MS: number;
};

type ChordTree = {
  children: Record<string, ChordNode>;
};

type ChordNode =
  | { type: "action"; actionId: string }
  | { type: "open-view"; view: string }
  | { type: "switch-workspace"; index: number }
  | { type: "open-extension-popup"; extensionId: string }
  | { type: "prefix"; timeoutMs: number; onTimeout: { type: "open-view"; view: string }; children: Record<string, ChordNode> };

type EventLike = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isTrusted?: boolean;
  preventDefault?: ReturnType<typeof vi.fn>;
  stopPropagation?: ReturnType<typeof vi.fn>;
  target?: unknown;
};

type EngineOptions = {
  chordTree: ChordTree;
  constants: ChordConstants;
  filterEvent?: (event: EventLike) => boolean;
  setTimeoutFn?: (fn: () => void, ms: number) => number;
  clearTimeoutFn?: (id: number) => void;
  disableTimers?: boolean;
  onArmed?: () => void;
  onAction?: (payload: unknown) => void;
  onOpenView?: (view: string | null, snapshot: string[], source: "match" | "timeout") => void;
  onStateChange?: (snapshot: string[]) => void;
  onCancel?: () => void;
  onBridgeKey?: (payload: unknown) => void;
};

type ChordEngine = {
  attach: (target: EventTargetLike) => void;
  detach: () => void;
  handleKey: (event: EventLike) => void;
  setInitialState: (snapshot: string[]) => void;
  exitBridge: () => void;
  reset: () => void;
  arm: () => void;
  isArmed: () => boolean;
  serializeState: () => string[];
};

type EventTargetLike = {
  addEventListener: (type: string, listener: (event: EventLike) => void, options: unknown) => void;
  removeEventListener: (type: string, listener: (event: EventLike) => void, options: unknown) => void;
};

const constants: ChordConstants = {
  CHORD_ROOT_TIMEOUT_MS: 100,
  CHORD_PREFIX_TIMEOUT_MS: 75,
};

function loadEngineScope(): ChordEngineScope {
  const filename = path.resolve(process.cwd(), "src/shared/chord-engine.js");
  const code = fs.readFileSync(filename, "utf8");
  const context: Record<string, unknown> = {};
  vm.runInNewContext(code, context, { filename });
  return context as ChordEngineScope;
}

const scope = loadEngineScope();

function makeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  return {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    tick(ms: number) {
      now += ms;
      const due = Array.from(timers.entries())
        .filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    pendingCount() {
      return timers.size;
    },
  };
}

function bindings() {
  return [
    { kind: "action", id: "previous-tab", chord: "P" },
    { kind: "open-view", view: "last-visited", chord: "R" },
    {
      kind: "prefix",
      id: "organize",
      chord: "O",
      view: "reorder-tabs",
      children: [
        { kind: "action", id: "reorder-by-domain", chord: "D" },
        { kind: "open-view", view: "tabs-by-age", chord: "A" },
        {
          kind: "prefix",
          id: "nested",
          chord: "N",
          view: "nested-view",
          children: [{ kind: "action", id: "nested-action", chord: "X" }],
        },
      ],
    },
  ];
}

function makeEngine(overrides: Partial<EngineOptions> = {}) {
  const clock = makeClock();
  const events = {
    armed: vi.fn(),
    action: vi.fn(),
    openView: vi.fn(),
    stateChange: vi.fn(),
    cancel: vi.fn(),
    bridgeKey: vi.fn(),
  };
  const chordTree = scope.buildChordTree(bindings(), ["1", "2"], constants);
  const engine = scope.createChordEngine({
    chordTree,
    constants,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    onArmed: events.armed,
    onAction: events.action,
    onOpenView: events.openView,
    onStateChange: events.stateChange,
    onCancel: events.cancel,
    onBridgeKey: events.bridgeKey,
    ...overrides,
  });
  return { engine, clock, events, chordTree };
}

function key(name: string, overrides: Partial<EventLike> = {}): EventLike {
  const eventKey = /^[A-Z]$/.test(name) ? name.toLowerCase() : name;
  const code = /^[a-zA-Z]$/.test(name) ? `Key${name.toUpperCase()}` : name === "!" ? "Digit1" : name;
  return {
    key: eventKey,
    code,
    isTrusted: true,
    shiftKey: /^[A-Z]$/.test(name) ? false : undefined,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  };
}

function target() {
  const listeners = new Map<string, Set<(event: EventLike) => void>>();
  return {
    addEventListener(type: string, listener: (event: EventLike) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: EventLike) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, event: EventLike) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size || 0;
    },
  };
}

describe("chord-engine helpers", () => {
  it("normalizes letter and shifted letter keys", () => {
    expect(scope.chordKeyFor(key("p"))).toBe("P");
    expect(scope.chordKeyFor(key("p", { shiftKey: true }))).toBe("Shift+P");
  });

  it("recovers Shift+digit chords from the physical code", () => {
    expect(scope.chordKeyFor(key("!", { shiftKey: true, code: "Digit1" }))).toBe("Shift+1");
  });

  it("ignores pure modifiers and modifier-combo keys", () => {
    expect(scope.chordKeyFor(key("Meta"))).toBeNull();
    expect(scope.chordKeyFor(key("p", { metaKey: true }))).toBeNull();
    expect(scope.chordKeyFor(key("l", { ctrlKey: true }))).toBeNull();
  });

  it("builds action, prefix, open-view, and workspace nodes", () => {
    const tree = scope.buildChordTree(bindings(), ["1"], constants);
    expect(tree.children.P).toMatchObject({ type: "action", actionId: "previous-tab" });
    expect(tree.children.R).toMatchObject({ type: "open-view", view: "last-visited" });
    expect(tree.children.O).toMatchObject({ type: "prefix", onTimeout: { view: "reorder-tabs" } });
    expect(tree.children["1"]).toMatchObject({ type: "switch-workspace", index: 0 });
  });
});

describe("chord-engine state machine", () => {
  it("arms at root and starts the root timer", () => {
    const { engine, clock, events } = makeEngine();
    engine.arm();
    expect(engine.isArmed()).toBe(true);
    expect(engine.serializeState()).toEqual([]);
    expect(events.armed).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(1);
  });

  it("fires a root action and resets", () => {
    const { engine, events, clock } = makeEngine();
    const event = key("p");
    engine.arm();
    engine.handleKey(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(events.action).toHaveBeenCalledWith({ type: "action", actionId: "previous-tab" });
    expect(engine.isArmed()).toBe(false);
    expect(clock.pendingCount()).toBe(0);
  });

  it("fires workspace digit actions from the root", () => {
    const { engine, events } = makeEngine();
    engine.arm();
    engine.handleKey(key("2"));

    expect(events.action).toHaveBeenCalledWith({ type: "switch-workspace", index: 1 });
    expect(engine.isArmed()).toBe(false);
  });

  it("opens an explicit view and enters bridge mode", () => {
    const { engine, events } = makeEngine();
    engine.arm();
    engine.handleKey(key("r"));

    expect(events.openView).toHaveBeenCalledWith("last-visited", ["R"], "match");
    expect(engine.isArmed()).toBe(true);
    expect(engine.serializeState()).toEqual(["R"]);
  });

  it("descends through a prefix, emits state, and then fires a child action", () => {
    const { engine, events, clock } = makeEngine();
    engine.arm();
    engine.handleKey(key("o"));

    expect(events.stateChange).toHaveBeenCalledWith(["O"]);
    expect(engine.serializeState()).toEqual(["O"]);
    expect(clock.pendingCount()).toBe(1);

    engine.handleKey(key("d"));
    expect(events.action).toHaveBeenCalledWith({ type: "action", actionId: "reorder-by-domain" });
    expect(engine.isArmed()).toBe(false);
  });

  it("supports nested prefixes", () => {
    const { engine, events } = makeEngine();
    engine.arm();
    engine.handleKey(key("o"));
    engine.handleKey(key("n"));
    engine.handleKey(key("x"));

    expect(events.stateChange).toHaveBeenNthCalledWith(1, ["O"]);
    expect(events.stateChange).toHaveBeenNthCalledWith(2, ["O", "N"]);
    expect(events.action).toHaveBeenCalledWith({ type: "action", actionId: "nested-action" });
  });

  it("opens the root menu on root timeout and bridges later keys", () => {
    const { engine, events, clock } = makeEngine();
    engine.arm();
    clock.tick(constants.CHORD_ROOT_TIMEOUT_MS);

    expect(events.openView).toHaveBeenCalledWith(null, [], "timeout");

    engine.handleKey(key("r"));
    expect(events.bridgeKey).toHaveBeenCalledWith({
      key: "r",
      code: "KeyR",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });
  });

  it("opens a prefix view on prefix timeout", () => {
    const { engine, events, clock } = makeEngine();
    engine.arm();
    engine.handleKey(key("o"));
    clock.tick(constants.CHORD_PREFIX_TIMEOUT_MS);

    expect(events.openView).toHaveBeenCalledWith("reorder-tabs", ["O"], "timeout");
  });

  it("does not let a cleared root timer fire after prefix descent", () => {
    const { engine, events, clock } = makeEngine();
    engine.arm();
    engine.handleKey(key("o"));
    clock.tick(constants.CHORD_ROOT_TIMEOUT_MS);

    expect(events.openView).toHaveBeenCalledWith("reorder-tabs", ["O"], "timeout");
    expect(events.openView).not.toHaveBeenCalledWith(null, [], "timeout");
  });

  it("cancels and eats Escape", () => {
    const { engine, events } = makeEngine();
    const event = key("Escape");
    engine.arm();
    engine.handleKey(event);

    expect(events.cancel).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(engine.isArmed()).toBe(false);
  });

  it("cancels and eats unknown chord keys", () => {
    const { engine, events } = makeEngine();
    const event = key("z");
    engine.arm();
    engine.handleKey(event);

    expect(events.cancel).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(engine.isArmed()).toBe(false);
  });

  it("passes through unarmed keys", () => {
    const { engine, events } = makeEngine();
    const event = key("p");
    engine.handleKey(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(events.action).not.toHaveBeenCalled();
  });

  it("passes through modifier-combo keys even while armed", () => {
    const { engine, events } = makeEngine();
    const event = key("t", { metaKey: true });
    engine.arm();
    engine.handleKey(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(events.action).not.toHaveBeenCalled();
    expect(engine.isArmed()).toBe(true);
  });

  it("honors filterEvent before touching an event", () => {
    const { engine, events } = makeEngine({ filterEvent: () => false });
    const event = key("p");
    engine.arm();
    engine.handleKey(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(events.action).not.toHaveBeenCalled();
    expect(engine.isArmed()).toBe(true);
  });

  it("ignores untrusted key events unless timers are disabled", () => {
    const trusted = makeEngine();
    trusted.engine.arm();
    trusted.engine.handleKey(key("p", { isTrusted: false }));
    expect(trusted.events.action).not.toHaveBeenCalled();

    const direct = makeEngine({ disableTimers: true });
    direct.engine.arm();
    direct.engine.handleKey(key("p", { isTrusted: false }));
    expect(direct.events.action).toHaveBeenCalledWith({ type: "action", actionId: "previous-tab" });
  });

  it("restores a valid prefix snapshot", () => {
    const { engine, events } = makeEngine();
    engine.setInitialState(["O"]);
    engine.handleKey(key("d"));

    expect(events.action).toHaveBeenCalledWith({ type: "action", actionId: "reorder-by-domain" });
  });

  it("falls back to root for an invalid snapshot", () => {
    const { engine, events } = makeEngine();
    engine.setInitialState(["NotReal"]);
    engine.handleKey(key("p"));

    expect(events.action).toHaveBeenCalledWith({ type: "action", actionId: "previous-tab" });
  });

  it("exits bridge mode cleanly", () => {
    const { engine, events } = makeEngine();
    engine.arm();
    engine.handleKey(key("r"));
    engine.exitBridge();
    engine.handleKey(key("p"));

    expect(events.bridgeKey).not.toHaveBeenCalled();
    expect(events.action).not.toHaveBeenCalledWith({ type: "action", actionId: "previous-tab" });
    expect(engine.isArmed()).toBe(false);
  });

  it("attached blur cancels an armed chord and detach removes listeners", () => {
    const { engine, events } = makeEngine();
    const node = target();
    engine.attach(node);
    expect(node.listenerCount("keydown")).toBe(1);
    expect(node.listenerCount("blur")).toBe(1);

    engine.arm();
    node.dispatch("blur", key("Blur"));
    expect(events.cancel).toHaveBeenCalledTimes(1);
    expect(engine.isArmed()).toBe(false);

    engine.detach();
    expect(node.listenerCount("keydown")).toBe(0);
    expect(node.listenerCount("blur")).toBe(0);
  });

  it("attached keydown listener uses the same handleKey path", () => {
    const { engine, events } = makeEngine();
    const node = target();
    engine.attach(node);
    engine.arm();
    node.dispatch("keydown", key("p"));

    expect(events.action).toHaveBeenCalledWith({ type: "action", actionId: "previous-tab" });
  });
});
