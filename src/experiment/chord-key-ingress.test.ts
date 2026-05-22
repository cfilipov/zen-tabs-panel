import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type KeyData = {
  kind: "key";
  key: string;
  code?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  source?: string;
};

type Ingress = {
  submit: (keyData: KeyData, source: string) => string;
  resetForArm: () => void;
  stats: () => { consumed: number; duplicates: number; recent: number; sources: Record<string, number> };
};

function loadScope() {
  const abs = path.resolve(process.cwd(), "src/experiment/chord-key-ingress.js");
  const code = fs.readFileSync(abs, "utf8");
  const context: Record<string, unknown> = {};
  vm.runInNewContext(code, context, { filename: abs });
  return context as {
    createChordKeyIngress: (options: {
      chordSession: { acceptKey: (keyData: KeyData) => void };
      debugTrace?: (type: string, payload: Record<string, unknown>) => void;
      nowMs: () => number;
      echoWindowMs?: number;
    }) => Ingress;
  };
}

function key(keyValue: string, options: Partial<KeyData> = {}): KeyData {
  return {
    kind: "key",
    key: keyValue,
    code: options.code || (/^[a-z]$/i.test(keyValue) ? `Key${keyValue.toUpperCase()}` : `Digit${keyValue}`),
    shiftKey: !!options.shiftKey,
    altKey: !!options.altKey,
    ctrlKey: !!options.ctrlKey,
    metaKey: !!options.metaKey,
    source: options.source,
  };
}

describe("chord key ingress", () => {
  it("suppresses delayed cross-source echoes of a fallback key", () => {
    const scope = loadScope();
    let now = 0;
    const acceptKey = vi.fn();
    const debugTrace = vi.fn();
    const ingress = scope.createChordKeyIngress({
      chordSession: { acceptKey },
      debugTrace,
      nowMs: () => now,
    });

    expect(ingress.submit(key("q"), "fallback")).toBe("consumed");
    now = 800;
    expect(ingress.submit(key("q"), "content-shim")).toBe("duplicate");

    expect(acceptKey).toHaveBeenCalledTimes(1);
    expect(acceptKey).toHaveBeenCalledWith(expect.objectContaining({ key: "q", source: "fallback" }));
    expect(debugTrace).toHaveBeenCalledWith("ingress-duplicate-suppressed", expect.objectContaining({
      key: "q",
      source: "content-shim",
      originalSource: "fallback",
    }));
  });

  it("suppresses one echo for each fallback key in FIFO order", () => {
    const scope = loadScope();
    let now = 0;
    const acceptKey = vi.fn();
    const ingress = scope.createChordKeyIngress({
      chordSession: { acceptKey },
      nowMs: () => now,
    });

    expect(ingress.submit(key("1"), "fallback")).toBe("consumed");
    now = 50;
    expect(ingress.submit(key("1"), "fallback")).toBe("consumed");
    now = 200;
    expect(ingress.submit(key("1"), "content-shim")).toBe("duplicate");
    now = 220;
    expect(ingress.submit(key("1"), "content-shim")).toBe("duplicate");

    expect(acceptKey).toHaveBeenCalledTimes(2);
    expect(ingress.stats()).toEqual(expect.objectContaining({ consumed: 2, duplicates: 2, recent: 0 }));
  });

  it("preserves same-source repeated keys", () => {
    const scope = loadScope();
    let now = 0;
    const acceptKey = vi.fn();
    const ingress = scope.createChordKeyIngress({
      chordSession: { acceptKey },
      nowMs: () => now,
    });

    expect(ingress.submit(key("1"), "content-shim")).toBe("consumed");
    now = 10;
    expect(ingress.submit(key("1"), "content-shim")).toBe("consumed");

    expect(acceptKey).toHaveBeenCalledTimes(2);
    expect(ingress.stats()).toEqual(expect.objectContaining({ consumed: 2, duplicates: 0 }));
  });

  it("clears recent keys between chord arms", () => {
    const scope = loadScope();
    let now = 0;
    const acceptKey = vi.fn();
    const ingress = scope.createChordKeyIngress({
      chordSession: { acceptKey },
      nowMs: () => now,
    });

    expect(ingress.submit(key("q"), "fallback")).toBe("consumed");
    ingress.resetForArm();
    now = 20;
    expect(ingress.submit(key("q"), "content-shim")).toBe("consumed");

    expect(acceptKey).toHaveBeenCalledTimes(2);
    expect(ingress.stats()).toEqual(expect.objectContaining({ consumed: 2, duplicates: 0 }));
  });
});
