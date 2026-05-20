import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type ShimScope = {
  createChordShim: (opts: Record<string, unknown>) => ChordShim;
};

type ChordShim = {
  attach: (target: EventTargetLike) => void;
  detach: () => void;
  handleKey: (event: EventLike) => void;
  arm: () => void;
  disarm: (reason?: string) => void;
  isArmed: () => boolean;
};

type EventLike = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isTrusted?: boolean;
  timeStamp?: number;
  preventDefault?: ReturnType<typeof vi.fn>;
  stopPropagation?: ReturnType<typeof vi.fn>;
};

type EventTargetLike = {
  addEventListener: (type: string, listener: (event: EventLike) => void, options: unknown) => void;
  removeEventListener: (type: string, listener: (event: EventLike) => void, options: unknown) => void;
};

function loadShimScope(): ShimScope {
  const filename = path.resolve(process.cwd(), "src/shared/chord-shim.js");
  const code = fs.readFileSync(filename, "utf8");
  const context: Record<string, unknown> = {};
  vm.runInNewContext(code, context, { filename });
  return context as ShimScope;
}

const scope = loadShimScope();

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
      for (const [id, timer] of Array.from(timers.entries())) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pendingCount() {
      return timers.size;
    },
  };
}

function key(name: string, overrides: Partial<EventLike> = {}): EventLike {
  return {
    key: name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isTrusted: true,
    timeStamp: 1234,
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

describe("chord-shim", () => {
  it("suppresses and forwards keys only while armed", () => {
    const forwardKey = vi.fn();
    const shim = scope.createChordShim({ forwardKey, failsafeTimeoutMs: 0 });
    const event = key("p");

    shim.handleKey(event);
    expect(forwardKey).not.toHaveBeenCalled();

    shim.arm();
    shim.handleKey(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(forwardKey).toHaveBeenCalledWith({
      kind: "key",
      key: "p",
      code: "KeyP",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shimSeq: 1,
      shimTs: 1234,
    });
  });

  it("passes through modifier keys and modifier combos", () => {
    const forwardKey = vi.fn();
    const shim = scope.createChordShim({ forwardKey, failsafeTimeoutMs: 0 });
    shim.arm();
    const meta = key("Meta");
    const cmdT = key("t", { metaKey: true });

    shim.handleKey(meta);
    shim.handleKey(cmdT);

    expect(meta.preventDefault).not.toHaveBeenCalled();
    expect(cmdT.preventDefault).not.toHaveBeenCalled();
    expect(forwardKey).not.toHaveBeenCalled();
    expect(shim.isArmed()).toBe(true);
  });

  it("honors event filters and ignores untrusted events", () => {
    const forwardKey = vi.fn();
    const shim = scope.createChordShim({ forwardKey, filterEvent: () => false, failsafeTimeoutMs: 0 });
    shim.arm();
    shim.handleKey(key("p"));
    expect(forwardKey).not.toHaveBeenCalled();

    const trusted = scope.createChordShim({ forwardKey, failsafeTimeoutMs: 0 });
    trusted.arm();
    trusted.handleKey(key("p", { isTrusted: false }));
    expect(forwardKey).not.toHaveBeenCalled();
  });

  it("auto-disarms via failsafe timeout", () => {
    const clock = makeClock();
    const onDisarmed = vi.fn();
    const shim = scope.createChordShim({
      forwardKey: vi.fn(),
      setTimeoutFn: clock.setTimeout,
      clearTimeoutFn: clock.clearTimeout,
      failsafeTimeoutMs: 50,
      onDisarmed,
    });

    shim.arm();
    expect(shim.isArmed()).toBe(true);
    expect(clock.pendingCount()).toBe(1);
    clock.tick(50);

    expect(shim.isArmed()).toBe(false);
    expect(onDisarmed).toHaveBeenCalledWith("failsafe");
  });

  it("attach and detach manage listeners", () => {
    const shim = scope.createChordShim({ forwardKey: vi.fn(), failsafeTimeoutMs: 0 });
    const node = target();
    shim.attach(node);
    expect(node.listenerCount("keydown")).toBe(1);
    expect(node.listenerCount("blur")).toBe(1);

    shim.detach();
    expect(node.listenerCount("keydown")).toBe(0);
    expect(node.listenerCount("blur")).toBe(0);
  });

  it("blur disarms an attached shim", () => {
    const shim = scope.createChordShim({ forwardKey: vi.fn(), failsafeTimeoutMs: 0 });
    const node = target();
    shim.attach(node);
    shim.arm();
    node.dispatch("blur", key("Blur"));

    expect(shim.isArmed()).toBe(false);
  });
});
