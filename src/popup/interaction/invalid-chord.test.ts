import { describe, expect, it } from "vitest";
import {
  displayInvalidChordKey,
  invalidChordMessage,
  isInvalidChordFeedbackInput,
} from "./invalid-chord";

describe("invalid chord feedback", () => {
  it("formats display names for structural-looking keys", () => {
    expect(displayInvalidChordKey(null)).toBe("that key");
    expect(displayInvalidChordKey(" ")).toBe("Space");
    expect(displayInvalidChordKey("\\")).toBe("\\");
    expect(displayInvalidChordKey("ArrowLeft")).toBe("Left");
    expect(displayInvalidChordKey("ArrowRight")).toBe("Right");
    expect(displayInvalidChordKey("ArrowUp")).toBe("Up");
    expect(displayInvalidChordKey("ArrowDown")).toBe("Down");
    expect(invalidChordMessage("x")).toBe("No shortcut for x");
  });

  it("allows plain non-structural keys to show invalid feedback", () => {
    expect(isInvalidChordFeedbackInput({ key: "x" })).toBe(true);
    expect(isInvalidChordFeedbackInput({ key: "\\" })).toBe(true);
  });

  it("suppresses feedback for modifiers and structural UI keys", () => {
    expect(isInvalidChordFeedbackInput({ key: "x", metaKey: true })).toBe(false);
    expect(isInvalidChordFeedbackInput({ key: "Shift" })).toBe(false);
    expect(isInvalidChordFeedbackInput({ key: "Escape" })).toBe(false);
    expect(isInvalidChordFeedbackInput({ key: "Backspace" })).toBe(false);
    expect(isInvalidChordFeedbackInput({ key: "Tab" })).toBe(false);
    expect(isInvalidChordFeedbackInput({ key: "Enter" })).toBe(false);
    expect(isInvalidChordFeedbackInput({ key: " " })).toBe(false);
    expect(isInvalidChordFeedbackInput({ key: "ArrowDown" })).toBe(false);
  });
});
