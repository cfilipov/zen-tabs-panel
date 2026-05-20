import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type ChordConstants = {
  CHORD_ROOT_TIMEOUT_MS: number;
  CHORD_PREFIX_TIMEOUT_MS: number;
};

type EventLike = {
  kind: "key";
  key: string;
  code?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isTrusted?: boolean;
  preventDefault?: ReturnType<typeof vi.fn>;
  stopPropagation?: ReturnType<typeof vi.fn>;
};

const constants: ChordConstants = {
  CHORD_ROOT_TIMEOUT_MS: 100,
  CHORD_PREFIX_TIMEOUT_MS: 75,
};

function loadScope(filename: string) {
  const abs = path.resolve(process.cwd(), filename);
  const code = fs.readFileSync(abs, "utf8");
  const context: Record<string, unknown> = {};
  vm.runInNewContext(code, context, { filename: abs });
  return context;
}

const treeScope = loadScope("src/shared/chord-tree.js") as {
  buildChordTree: (bindings: unknown[], workspaceChords: string[], constants: ChordConstants) => unknown;
  chordKeyFor: (event: EventLike) => string | null;
};
const sessionScope = loadScope("src/experiment/chord-session.js") as {
  createChordSession: (options: Record<string, unknown>) => {
    arm: () => void;
    acceptKey: (event: EventLike) => void;
    reset: () => void;
    exitBridge: () => void;
    isArmed: () => boolean;
    getTraversalState: () => { armed: boolean; path: string[] };
  };
};

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

function makeSession() {
  const clock = makeClock();
  const events = {
    armed: vi.fn(),
    action: vi.fn(),
    openView: vi.fn(),
    stateChange: vi.fn(),
    cancel: vi.fn(),
    bridgeKey: vi.fn(),
  };
  const chordTree = treeScope.buildChordTree(bindings(), ["1", "2"], constants);
  const session = sessionScope.createChordSession({
    chordTree,
    chordKeyFor: treeScope.chordKeyFor,
    constants,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    onArmed: events.armed,
    onAction: events.action,
    onOpenView: events.openView,
    onStateChange: events.stateChange,
    onCancel: events.cancel,
    onBridgeKey: events.bridgeKey,
  });
  return { session, clock, events, chordTree };
}

function key(name: string, overrides: Partial<EventLike> = {}): EventLike {
  const eventKey = /^[A-Z]$/.test(name) ? name.toLowerCase() : name;
  const code = /^[a-zA-Z]$/.test(name) ? `Key${name.toUpperCase()}` : name === "!" ? "Digit1" : name;
  return {
    kind: "key",
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

describe("chord tree helpers", () => {
  it("normalizes letter and shifted letter keys", () => {
    expect(treeScope.chordKeyFor(key("p"))).toBe("P");
    expect(treeScope.chordKeyFor(key("p", { shiftKey: true }))).toBe("Shift+P");
  });

  it("recovers Shift+digit chords from the physical code", () => {
    expect(treeScope.chordKeyFor(key("!", { shiftKey: true, code: "Digit1" }))).toBe("Shift+1");
  });

  it("ignores pure modifiers and modifier-combo keys", () => {
    expect(treeScope.chordKeyFor(key("Meta"))).toBeNull();
    expect(treeScope.chordKeyFor(key("p", { metaKey: true }))).toBeNull();
    expect(treeScope.chordKeyFor(key("l", { ctrlKey: true }))).toBeNull();
  });

  it("builds action, prefix, open-view, and workspace nodes", () => {
    const tree = treeScope.buildChordTree(bindings(), ["1"], constants) as { children: Record<string, unknown> };
    expect(tree.children.P).toMatchObject({ type: "action", actionId: "previous-tab" });
    expect(tree.children.R).toMatchObject({ type: "open-view", view: "last-visited" });
    expect(tree.children.O).toMatchObject({ type: "prefix", onTimeout: { view: "reorder-tabs" } });
    expect(tree.children["1"]).toMatchObject({ type: "switch-workspace", index: 0 });
  });
});

describe("ChordSession traversal", () => {
  it("arms at root and starts the root timer", () => {
    const { session, clock, events } = makeSession();
    session.arm();
    expect(session.isArmed()).toBe(true);
    expect(session.getTraversalState().path).toEqual([]);
    expect(events.armed).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(1);
  });

  it("fires a root action and resets", () => {
    const { session, events, clock } = makeSession();
    const event = key("p");
    session.arm();
    session.acceptKey(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(events.action).toHaveBeenCalledWith({ type: "action", actionId: "previous-tab" });
    expect(session.isArmed()).toBe(false);
    expect(clock.pendingCount()).toBe(0);
  });

  it("fires workspace digit actions from the root", () => {
    const { session, events } = makeSession();
    session.arm();
    session.acceptKey(key("2"));

    expect(events.action).toHaveBeenCalledWith({ type: "switch-workspace", index: 1 });
    expect(session.isArmed()).toBe(false);
  });

  it("opens an explicit view and enters bridge mode", () => {
    const { session, events } = makeSession();
    session.arm();
    session.acceptKey(key("r"));

    expect(events.openView).toHaveBeenCalledWith("last-visited", ["R"], "match");
    expect(session.isArmed()).toBe(true);
    expect(session.getTraversalState().path).toEqual(["R"]);
  });

  it("descends through a prefix, emits state, and then fires a child action", () => {
    const { session, events, clock } = makeSession();
    session.arm();
    session.acceptKey(key("o"));

    expect(events.stateChange).toHaveBeenCalledWith(["O"]);
    expect(session.getTraversalState().path).toEqual(["O"]);
    expect(clock.pendingCount()).toBe(1);

    session.acceptKey(key("d"));
    expect(events.action).toHaveBeenCalledWith({ type: "action", actionId: "reorder-by-domain" });
    expect(session.isArmed()).toBe(false);
  });

  it("supports nested prefixes", () => {
    const { session, events } = makeSession();
    session.arm();
    session.acceptKey(key("o"));
    session.acceptKey(key("n"));
    session.acceptKey(key("x"));

    expect(events.stateChange).toHaveBeenNthCalledWith(1, ["O"]);
    expect(events.stateChange).toHaveBeenNthCalledWith(2, ["O", "N"]);
    expect(events.action).toHaveBeenCalledWith({ type: "action", actionId: "nested-action" });
  });

  it("opens the root menu on root timeout and bridges later keys", () => {
    const { session, events, clock } = makeSession();
    session.arm();
    clock.tick(constants.CHORD_ROOT_TIMEOUT_MS);

    expect(events.openView).toHaveBeenCalledWith(null, [], "timeout");

    session.acceptKey(key("r"));
    expect(events.bridgeKey).toHaveBeenCalledWith({
      key: "r",
      code: "KeyR",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shimSeq: undefined,
      shimTs: undefined,
    });
  });

  it("opens a prefix view on prefix timeout", () => {
    const { session, events, clock } = makeSession();
    session.arm();
    session.acceptKey(key("o"));
    clock.tick(constants.CHORD_PREFIX_TIMEOUT_MS);

    expect(events.openView).toHaveBeenCalledWith("reorder-tabs", ["O"], "timeout");
  });

  it("cancels and eats Escape", () => {
    const { session, events } = makeSession();
    const event = key("Escape");
    session.arm();
    session.acceptKey(event);

    expect(events.cancel).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(session.isArmed()).toBe(false);
  });

  it("cancels and eats unknown chord keys", () => {
    const { session, events } = makeSession();
    const event = key("z");
    session.arm();
    session.acceptKey(event);

    expect(events.cancel).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(session.isArmed()).toBe(false);
  });

  it("passes through unarmed keys", () => {
    const { session, events } = makeSession();
    const event = key("p");
    session.acceptKey(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(events.action).not.toHaveBeenCalled();
  });

  it("passes through modifier-combo keys even while armed", () => {
    const { session, events } = makeSession();
    const event = key("t", { metaKey: true });
    session.arm();
    session.acceptKey(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(events.action).not.toHaveBeenCalled();
    expect(session.isArmed()).toBe(true);
  });

  it("ignores untrusted key events", () => {
    const { session, events } = makeSession();
    session.arm();
    session.acceptKey(key("p", { isTrusted: false }));
    expect(events.action).not.toHaveBeenCalled();
  });

  it("exits bridge mode cleanly", () => {
    const { session, events } = makeSession();
    session.arm();
    session.acceptKey(key("r"));
    session.exitBridge();
    session.acceptKey(key("p"));

    expect(events.bridgeKey).not.toHaveBeenCalled();
    expect(events.action).not.toHaveBeenCalledWith({ type: "action", actionId: "previous-tab" });
    expect(session.isArmed()).toBe(false);
  });
});
