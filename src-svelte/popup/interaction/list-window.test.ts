import { describe, expect, it } from "vitest";
import {
  listWindowContainsIndex,
  loadWindowForIndex,
  relativeWindowIndex,
  rowInWindow,
  scrollTopForIndex,
  visibleRangeRequest,
} from "./list-window";

describe("list window transitions", () => {
  it("resolves rows by absolute index inside the current window", () => {
    const rows = ["a", "b", "c"];
    expect(relativeWindowIndex(12, 10)).toBe(2);
    expect(relativeWindowIndex(9, 10)).toBeNull();
    expect(rowInWindow(rows, 10, 11)).toBe("b");
    expect(rowInWindow(rows, 10, 14)).toBeNull();
  });

  it("detects whether an absolute index is already loaded", () => {
    expect(listWindowContainsIndex({ index: 30, offset: 20, rowCount: 80 })).toBe(true);
    expect(listWindowContainsIndex({ index: 19, offset: 20, rowCount: 80 })).toBe(false);
    expect(listWindowContainsIndex({ index: 100, offset: 20, rowCount: 80 })).toBe(false);
  });

  it("loads around selection jumps with lookbehind and bounded offsets", () => {
    expect(loadWindowForIndex({ index: 30, offset: 20, rowCount: 80 })).toBeNull();
    expect(loadWindowForIndex({ index: 5, offset: 20, rowCount: 80 })).toEqual({ offset: 0, limit: 80 });
    expect(loadWindowForIndex({ index: 150, offset: 20, rowCount: 80 })).toEqual({ offset: 130, limit: 80 });
    expect(loadWindowForIndex({ index: -1, offset: 20, rowCount: 80 })).toBeNull();
  });

  it("normalizes virtual-list visible range requests", () => {
    expect(visibleRangeRequest(-10, 20)).toEqual({ offset: 0, limit: 60 });
    expect(visibleRangeRequest(100, 120)).toEqual({ offset: 100, limit: 120 });
  });

  it("computes scrollTop needed to reveal a row", () => {
    expect(scrollTopForIndex({ index: 2, scrollTop: 120, clientHeight: 160 })).toBe(96);
    expect(scrollTopForIndex({ index: 8, scrollTop: 120, clientHeight: 160 })).toBe(272);
    expect(scrollTopForIndex({ index: 5, scrollTop: 120, clientHeight: 160 })).toBe(128);
  });

  it("keeps rows clear of scroll container padding", () => {
    expect(scrollTopForIndex({
      index: 8,
      scrollTop: 120,
      clientHeight: 160,
      paddingTop: 6,
      paddingBottom: 2,
    })).toBe(280);
  });
});
