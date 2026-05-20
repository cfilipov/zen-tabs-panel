import { describe, expect, it } from "vitest";
import { AVAILABILITY_PREDICATES, unavailableNavigationIds, type AvailabilityContext } from "./availability";

const availableContext: AvailabilityContext = {
  previewsById: {
    "go-to-parent-tab": {},
  },
  counts: {
    "child-tabs": 1,
    "sibling-tabs": 1,
    "parent-tabs": 1,
    "unvisited-tabs": 1,
    duplicates: 1,
  },
  recentlyClosedCount: 1,
  navigationEntryCount: 2,
  currentTabIsPinned: true,
  currentTabCanReaderMode: true,
};

describe("availability predicates", () => {
  it("keeps every predicate id backed by a real function", () => {
    expect(Object.keys(AVAILABILITY_PREDICATES).sort()).toEqual([
      "needsChildren",
      "needsDuplicates",
      "needsHistory",
      "needsParent",
      "needsParentTabs",
      "needsPinnedTab",
      "needsReaderMode",
      "needsRecentlyClosed",
      "needsSiblings",
      "needsUnvisited",
    ]);
  });

  it("disables flagged navigation nodes from summary state", () => {
    const unavailable = unavailableNavigationIds({
      ...availableContext,
      previewsById: {},
      counts: { ...availableContext.counts, "child-tabs": 0 },
      currentTabIsPinned: false,
      currentTabCanReaderMode: false,
    });

    expect(unavailable.has("go-to-parent-tab")).toBe(true);
    expect(unavailable.has("child-tabs")).toBe(true);
    expect(unavailable.has("reset-pinned-tab")).toBe(true);
    expect(unavailable.has("toggle-reader-mode")).toBe(true);
    expect(unavailable.has("reload-tab")).toBe(false);
  });

  it("leaves flagged navigation nodes enabled when predicates pass", () => {
    const unavailable = unavailableNavigationIds(availableContext);

    expect(unavailable.has("go-to-parent-tab")).toBe(false);
    expect(unavailable.has("child-tabs")).toBe(false);
    expect(unavailable.has("reset-pinned-tab")).toBe(false);
    expect(unavailable.has("toggle-reader-mode")).toBe(false);
  });
});
