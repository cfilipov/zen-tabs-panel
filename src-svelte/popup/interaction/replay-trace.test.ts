import { describe, expect, it } from "vitest";
import { replayKeyForBadgeIndex, replayKeyForNavigationIndex } from "./replay-trace";

describe("replay trace keys", () => {
  it("maps visible row badge indexes to replay keys", () => {
    expect(replayKeyForBadgeIndex(0)).toBe("1");
    expect(replayKeyForBadgeIndex(8)).toBe("9");
    expect(replayKeyForBadgeIndex(9)).toBeNull();
    expect(replayKeyForBadgeIndex(-1)).toBeNull();
  });

  it("skips the current navigation entry when computing visible badge keys", () => {
    const history = {
      index: 1,
      entries: [
        { title: "Back", url: "https://back.test" },
        { title: "Current", url: "https://current.test" },
        { title: "Forward", url: "https://forward.test" },
      ],
    };

    expect(replayKeyForNavigationIndex(history, 0)).toBe("1");
    expect(replayKeyForNavigationIndex(history, 1)).toBeNull();
    expect(replayKeyForNavigationIndex(history, 2)).toBe("2");
  });
});

