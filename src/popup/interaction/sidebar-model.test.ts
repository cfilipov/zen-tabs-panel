import { describe, expect, it } from "vitest";
import { buildSidebarModel } from "./sidebar-model";

describe("sidebar model", () => {
  it("shows close affordances only for closeable tab views", () => {
    expect(buildSidebarModel({
      view: "last-visited",
      selectedIndex: 2,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: false,
    }).hints.map((hint) => hint.id)).toEqual(["close"]);

    expect(buildSidebarModel({
      view: "recently-closed",
      selectedIndex: 2,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: false,
    }).hints.map((hint) => hint.id)).toEqual(["restore"]);
  });

  it("keeps recently closed as hints-only and hides it until a row is selected", () => {
    const empty = buildSidebarModel({
      view: "recently-closed",
      selectedIndex: -1,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: false,
    });
    const selected = buildSidebarModel({
      view: "recently-closed",
      selectedIndex: 0,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: false,
    });

    expect(empty.hintsOnly).toBe(true);
    expect(empty.hidden).toBe(true);
    expect(empty.hints[0]?.hidden).toBe(true);
    expect(selected.hidden).toBe(false);
    expect(selected.hints[0]?.hidden).toBe(false);
  });

  it("adds child close-all and parent drill hints", () => {
    expect(buildSidebarModel({
      view: "child-tabs",
      selectedIndex: 0,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: false,
    }).hints.map((hint) => hint.id)).toEqual(["close", "close-all"]);

    expect(buildSidebarModel({
      view: "parent-tabs",
      selectedIndex: -1,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: false,
    }).hints).toMatchObject([
      { id: "close", hidden: true },
      { id: "children", hidden: true },
    ]);
  });

  it("keeps workspace-filter views visible even without hints", () => {
    expect(buildSidebarModel({
      view: "domains",
      selectedIndex: -1,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: false,
    }).hidden).toBe(false);

    expect(buildSidebarModel({
      view: "tab-info",
      selectedIndex: -1,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: false,
    }).hidden).toBe(true);
  });

  it("formats sort labels for sortable views", () => {
    expect(buildSidebarModel({
      view: "domains",
      selectedIndex: -1,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: false,
    }).sortLabel).toBe("Sort by A-Z");
    expect(buildSidebarModel({
      view: "domains",
      selectedIndex: -1,
      domainsSortAlpha: true,
      tabsByAgeNewestFirst: false,
    }).sortLabel).toBe("Sort by count");
    expect(buildSidebarModel({
      view: "tabs-by-age",
      selectedIndex: -1,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: true,
    }).sortLabel).toBe("Sort by oldest");
  });
});
