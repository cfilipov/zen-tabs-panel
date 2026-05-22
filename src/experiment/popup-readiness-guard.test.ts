import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

type GuardScope = {
  acceptsPopupViewStateMessage: (
    deps: {
      matchesPopupInstance: (inst: number) => boolean;
      matchesReadinessGeneration: (readyGen: number) => boolean;
      hasActiveBridge: () => boolean;
      hasPendingReveal: () => boolean;
    },
    inst: number,
    readyGen?: number,
  ) => boolean;
};

function loadGuard() {
  const root = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(root, "popup-readiness-guard.js"), "utf8");
  const context = vm.createContext({} as GuardScope);
  vm.runInContext(source, context);
  return context as GuardScope;
}

function deps(options: {
  inst?: number;
  readyGen?: number;
  activeBridge?: boolean;
  pendingReveal?: boolean;
} = {}) {
  return {
    matchesPopupInstance: (inst: number) => inst === (options.inst ?? 1),
    matchesReadinessGeneration: (readyGen: number) => readyGen === (options.readyGen ?? 2),
    hasActiveBridge: () => !!options.activeBridge,
    hasPendingReveal: () => !!options.pendingReveal,
  };
}

describe("popup readiness guard", () => {
  it("rejects stale popup instances", () => {
    const guard = loadGuard();

    expect(guard.acceptsPopupViewStateMessage(deps({ inst: 2 }), 1, 2)).toBe(false);
  });

  it("rejects stale readiness generations", () => {
    const guard = loadGuard();

    expect(guard.acceptsPopupViewStateMessage(deps({ readyGen: 3 }), 1, 2)).toBe(false);
  });

  it("accepts current readiness generations", () => {
    const guard = loadGuard();

    expect(guard.acceptsPopupViewStateMessage(deps({ readyGen: 2 }), 1, 2)).toBe(true);
  });

  it("rejects missing readyGen during bridge or pending reveal", () => {
    const guard = loadGuard();

    expect(guard.acceptsPopupViewStateMessage(deps({ activeBridge: true }), 1)).toBe(false);
    expect(guard.acceptsPopupViewStateMessage(deps({ pendingReveal: true }), 1)).toBe(false);
  });

  it("keeps the legacy no-readyGen path only for idle visible popups", () => {
    const guard = loadGuard();

    expect(guard.acceptsPopupViewStateMessage(deps(), 1)).toBe(true);
  });
});
