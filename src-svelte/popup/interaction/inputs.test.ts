import { describe, expect, it } from "vitest";
import { chordFromKey } from "./inputs";

describe("chordFromKey", () => {
  it("normalizes letter keys to chord labels", () => {
    expect(chordFromKey({ kind: "key", key: "n", code: "KeyN" })).toBe("N");
    expect(chordFromKey({ kind: "key", key: "N", code: "KeyN", shiftKey: true })).toBe("Shift+N");
  });

  it("normalizes shifted digit keys from code instead of layout-dependent symbols", () => {
    expect(chordFromKey({ kind: "key", key: "!", code: "Digit1", shiftKey: true })).toBe("Shift+1");
  });
});
