import { describe, expect, it } from "vitest";
import { tabAgeLabel, tabSubtitleForView } from "./tab-display";

const row = {
  domId: "1000-tab",
  focusCount: 7,
} as never;

describe("tab display helpers", () => {
  it("formats age labels from tab dom ids", () => {
    expect(tabAgeLabel(row, 1500, (ms) => `${ms}ms`)).toBe("500ms");
  });

  it("returns view-specific subtitles", () => {
    expect(tabSubtitleForView("most-visited", row, { now: 1500, formatDuration: (ms) => `${ms}ms` }))
      .toBe("7 focuses");
    expect(tabSubtitleForView("tabs-by-age", row, { now: 1500, formatDuration: (ms) => `${ms}ms` }))
      .toBe("500ms");
    expect(tabSubtitleForView("last-visited", row, { now: 1500, formatDuration: (ms) => `${ms}ms` }))
      .toBe(null);
  });
});
