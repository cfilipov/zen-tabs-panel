import { describe, expect, it } from "vitest";
import { createViewLoadController } from "./view-load-controller";

describe("view load controller", () => {
  it("guards stale commits and finishes by generation and view", async () => {
    let currentView = "actions";
    let loading = false;
    let error: string | null = "old";
    const committed: string[] = [];
    const controller = createViewLoadController({
      getCurrentView: () => currentView,
      setCurrentView: (view) => { currentView = view; },
      setLoading: (value) => { loading = value; },
      setError: (value) => { error = value; },
    });

    const first = controller.begin("navigation");
    const second = controller.begin("recently-closed");

    expect(currentView).toBe("recently-closed");
    expect(loading).toBe(true);
    expect(error).toBe(null);
    expect(await first.commit(() => { committed.push("first"); })).toBe(false);
    expect(await second.commit(() => { committed.push("second"); })).toBe(true);
    expect(committed).toEqual(["second"]);
    expect(first.finish()).toBe(false);
    expect(second.finish()).toBe(true);
    expect(loading).toBe(false);
  });

  it("applies errors only for the active token", async () => {
    let currentView = "actions";
    let loading = false;
    let error: string | null = null;
    const controller = createViewLoadController({
      getCurrentView: () => currentView,
      setCurrentView: (view) => { currentView = view; },
      setLoading: (value) => { loading = value; },
      setError: (value) => { error = value; },
    });

    const stale = controller.begin("navigation");
    const active = controller.begin("profiles", { loading: false });

    expect(loading).toBe(false);
    expect(await stale.fail(new Error("stale"), (message) => { error = message; })).toBe(false);
    expect(await active.fail(new Error("active"), (message) => { error = message; })).toBe(true);
    expect(error).toBe("active");
  });
});
