import { describe, expect, it } from "vitest";
import { createTerminalCommandBlocker } from "./terminal-command-block";

describe("terminal command blocker", () => {
  it("blocks briefly after a terminal command dispatch", () => {
    let now = 1000;
    const blocker = createTerminalCommandBlocker({ now: () => now, blockMs: 500 });

    expect(blocker.isBlocking()).toBe(false);
    blocker.markDispatched();
    expect(blocker.isBlocking()).toBe(true);

    now += 499;
    expect(blocker.isBlocking()).toBe(true);

    now += 1;
    expect(blocker.isBlocking()).toBe(false);
    expect(blocker.isBlocking()).toBe(false);
  });

  it("can be cleared manually", () => {
    const blocker = createTerminalCommandBlocker();

    blocker.markDispatched();
    expect(blocker.isBlocking()).toBe(true);
    blocker.clear();
    expect(blocker.isBlocking()).toBe(false);
  });
});
