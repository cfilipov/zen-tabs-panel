import { describe, expect, it } from "vitest";
import { createViewLoadController } from "../runtime/view-load-controller";
import { runViewLoad } from "./view-load-runner";

function createHarness() {
  let currentView = "initial";
  let loading = false;
  let error: string | null = null;
  const events: string[] = [];
  const controller = createViewLoadController<string>({
    getCurrentView: () => currentView,
    setCurrentView: (view) => {
      currentView = view;
      events.push(`view:${view}`);
    },
    setLoading: (value) => {
      loading = value;
      events.push(`loading:${value}`);
    },
    setError: (value) => {
      error = value;
      events.push(`error:${value}`);
    },
  });
  return { controller, events, state: () => ({ currentView, loading, error }) };
}

describe("view load runner", () => {
  it("runs begin, load, commit, and finish for current loads", async () => {
    const { controller, events, state } = createHarness();
    const committed: number[] = [];

    const didCommit = await runViewLoad({
      controller,
      view: "profiles",
      load: async () => 42,
      commit: (result) => {
        committed.push(result);
      },
      fail: () => {
        events.push("fail");
      },
    });

    expect(didCommit).toBe(true);
    expect(committed).toEqual([42]);
    expect(state()).toEqual({ currentView: "profiles", loading: false, error: null });
    expect(events).toEqual(["view:profiles", "error:null", "loading:true", "loading:false"]);
  });

  it("routes failures through token.fail and finishes", async () => {
    const { controller, events, state } = createHarness();

    const didCommit = await runViewLoad({
      controller,
      view: "recently-closed",
      load: async () => {
        throw new Error("boom");
      },
      commit: () => {
        events.push("commit");
      },
      fail: (message) => {
        events.push(`fail:${message}`);
      },
    });

    expect(didCommit).toBe(true);
    expect(state()).toEqual({ currentView: "recently-closed", loading: false, error: null });
    expect(events).toContain("fail:boom");
    expect(events.at(-1)).toBe("loading:false");
  });

  it("skips stale commits and finish when the view changes mid-load", async () => {
    const { controller, events } = createHarness();

    const didCommit = await runViewLoad({
      controller,
      view: "navigation",
      load: async () => {
        controller.begin("profiles");
        return 42;
      },
      commit: () => {
        events.push("commit");
      },
      fail: () => {
        events.push("fail");
      },
    });

    expect(didCommit).toBe(false);
    expect(events).not.toContain("commit");
    expect(events.at(-1)).toBe("loading:true");
  });

  it("honors loading false for non-spinner loads", async () => {
    const { controller, events } = createHarness();

    await runViewLoad({
      controller,
      view: "duplicate-prompt",
      loading: false,
      load: async () => null,
      commit: () => {},
      fail: () => {},
    });

    expect(events).toContain("loading:false");
  });

  it("runs afterBegin with the load token before loading", async () => {
    const { controller, events } = createHarness();

    await runViewLoad({
      controller,
      view: "parent-tabs",
      afterBegin: (token) => {
        events.push(`after:${token.view}:${token.id}:${token.isCurrent()}`);
      },
      load: async () => {
        events.push("load");
        return 1;
      },
      commit: () => {
        events.push("commit");
      },
      fail: () => {
        events.push("fail");
      },
    });

    expect(events).toContain("after:parent-tabs:1:true");
    expect(events.indexOf("after:parent-tabs:1:true")).toBeLessThan(events.indexOf("load"));
    expect(events).toContain("commit");
  });
});
