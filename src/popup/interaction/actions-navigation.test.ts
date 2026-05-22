import { describe, expect, it } from "vitest";
import { actionSectionStarts, nextActionSectionIndex, nextActionsPage, snappedActionsPage } from "./actions-navigation";

const sections = [
  { page: 1, items: [{}, {}] },
  { page: 1, items: [{}] },
  { page: 1, items: [] },
  { page: 1, items: [{}, {}, {}] },
  { page: 2, items: [{}, {}] },
];

describe("actions menu navigation transitions", () => {
  it("wraps action pages and returns null for no-op moves", () => {
    expect(nextActionsPage(1, 2, 2)).toBe(2);
    expect(nextActionsPage(1, 0, 2)).toBe(2);
    expect(nextActionsPage(2, 3, 2)).toBe(1);
    expect(nextActionsPage(1, 1, 2)).toBeNull();
    expect(nextActionsPage(1, 2, 1)).toBeNull();
  });

  it("computes non-empty section starts for the current page", () => {
    expect(actionSectionStarts(sections, 1)).toEqual([0, 2, 3]);
    expect(actionSectionStarts(sections, 2)).toEqual([0]);
  });

  it("maps native scroll snap positions back to action pages", () => {
    expect(snappedActionsPage(0, 400, [1, 2])).toBe(1);
    expect(snappedActionsPage(220, 400, [1, 2])).toBe(2);
    expect(snappedActionsPage(840, 400, [1, 2])).toBe(2);
    expect(snappedActionsPage(200, 0, [1, 2])).toBeNull();
    expect(snappedActionsPage(200, 400, [])).toBeNull();
  });

  it("jumps between section starts from the current selection", () => {
    expect(nextActionSectionIndex({
      sections,
      currentPage: 1,
      visibleItemCount: 6,
      selectedIndex: 0,
      delta: 1,
    })).toBe(2);

    expect(nextActionSectionIndex({
      sections,
      currentPage: 1,
      visibleItemCount: 6,
      selectedIndex: 4,
      delta: 1,
    })).toBe(0);

    expect(nextActionSectionIndex({
      sections,
      currentPage: 1,
      visibleItemCount: 6,
      selectedIndex: -1,
      delta: -1,
    })).toBe(3);
  });
});
