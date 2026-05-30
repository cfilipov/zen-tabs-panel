import { describe, expect, it } from "vitest";
import {
  listViewParams,
  normalizeWorkspaceFilter,
  shouldResetWorkspaceFilterForListOpen,
  toggleSortForView,
  toggleWorkspaceFilterValue,
  workspaceFilterFromListOpenParams,
  workspaceFilterByIndex,
  workspaceReloadKind,
} from "./sort-filter";

describe("sort and workspace filter transitions", () => {
  it("toggles domain sort for domains and domain-tabs", () => {
    expect(toggleSortForView("domains", { domainsSortAlpha: false, tabsByAgeNewestFirst: false }))
      .toEqual({ domainsSortAlpha: true, tabsByAgeNewestFirst: false, reloadView: "domains" });
    expect(toggleSortForView("domain-tabs", { domainsSortAlpha: true, tabsByAgeNewestFirst: false }))
      .toEqual({ domainsSortAlpha: false, tabsByAgeNewestFirst: false, reloadView: "domain-tabs" });
  });

  it("toggles tabs-by-age order without touching domain sort", () => {
    expect(toggleSortForView("tabs-by-age", { domainsSortAlpha: true, tabsByAgeNewestFirst: false }))
      .toEqual({ domainsSortAlpha: true, tabsByAgeNewestFirst: true, reloadView: "tabs-by-age" });
    expect(toggleSortForView("last-visited", { domainsSortAlpha: true, tabsByAgeNewestFirst: true }))
      .toEqual({ domainsSortAlpha: true, tabsByAgeNewestFirst: true, reloadView: null });
  });

  it("builds list params from workspace, domain, and sort state", () => {
    expect(listViewParams("domain-tabs", {
      workspaceFilter: "ws-1",
      currentDomain: "example.test",
      domainsSortAlpha: true,
      tabsByAgeNewestFirst: false,
    })).toEqual({ workspaceId: "ws-1", domain: "example.test" });

    expect(listViewParams("domains", {
      workspaceFilter: "all",
      currentDomain: null,
      domainsSortAlpha: true,
      tabsByAgeNewestFirst: false,
    })).toEqual({ sortAlpha: true });

    expect(listViewParams("tabs-by-age", {
      workspaceFilter: "all",
      currentDomain: null,
      domainsSortAlpha: false,
      tabsByAgeNewestFirst: true,
    })).toEqual({ newestFirst: true });
  });

  it("resolves workspace filter toggles and index shortcuts", () => {
    expect(normalizeWorkspaceFilter("")).toBe("all");
    expect(toggleWorkspaceFilterValue("all", "ws-active")).toBe("ws-active");
    expect(toggleWorkspaceFilterValue("all", null)).toBe("all");
    expect(toggleWorkspaceFilterValue("ws-active", "ws-active")).toBe("all");
    expect(workspaceFilterByIndex("all", [{ uuid: "ws-1" }], 0)).toBe("ws-1");
    expect(workspaceFilterByIndex("ws-1", [{ uuid: "ws-1" }], 0)).toBe("all");
    expect(workspaceFilterByIndex("all", [], 0)).toBeNull();
  });

  it("defaults list opens to all workspaces unless workspaceId is explicit", () => {
    expect(workspaceFilterFromListOpenParams({})).toBeNull();
    expect(workspaceFilterFromListOpenParams({ workspaceId: "ws-1" })).toBe("ws-1");
    expect(workspaceFilterFromListOpenParams({ workspaceId: "" })).toBe("all");
    expect(workspaceFilterFromListOpenParams({ workspaceId: 4 })).toBe("all");
    expect(shouldResetWorkspaceFilterForListOpen({})).toBe(true);
    expect(shouldResetWorkspaceFilterForListOpen({ workspaceId: "ws-1" })).toBe(false);
  });

  it("maps workspace-filter reload targets", () => {
    expect(workspaceReloadKind("domains")).toBe("list");
    expect(workspaceReloadKind("last-visited")).toBe("list");
    expect(workspaceReloadKind("duplicates")).toBe("duplicates");
    expect(workspaceReloadKind("recently-closed")).toBeNull();
  });
});
