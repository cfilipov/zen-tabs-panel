import { describe, expect, it } from "vitest";
import {
  canCloseAllInView,
  canDrillSelectionInView,
  canRestoreInView,
  isCloseableView,
  isSortableView,
  isWorkspaceFilterView,
} from "./view-capabilities";

describe("view capabilities", () => {
  it("keeps tab-list close capability shared by sidebar and keyboard handling", () => {
    expect(isCloseableView("last-visited")).toBe(true);
    expect(isCloseableView("domains")).toBe(true);
    expect(isCloseableView("domain-tabs")).toBe(true);
    expect(isCloseableView("duplicates")).toBe(true);
    expect(isCloseableView("duplicate-prompt")).toBe(true);
    expect(isCloseableView("recently-closed")).toBe(false);
  });

  it("keeps augmentation capabilities centralized", () => {
    expect(canCloseAllInView("child-tabs")).toBe(true);
    expect(canCloseAllInView("sibling-tabs")).toBe(false);
    expect(canRestoreInView("recently-closed")).toBe(true);
    expect(canDrillSelectionInView("parent-tabs")).toBe(true);
    expect(isSortableView("tabs-by-age")).toBe(true);
  });

  it("keeps workspace filter capability shared by sidebar and shortcuts", () => {
    expect(isWorkspaceFilterView("domains")).toBe(true);
    expect(isWorkspaceFilterView("duplicates")).toBe(true);
    expect(isWorkspaceFilterView("recently-closed")).toBe(false);
  });
});
