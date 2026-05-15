import { describe, expect, it } from "vitest";
import {
  LIST_VIEW_TITLES,
  isNativeListView,
  isNativePrefixView,
  isNativeTabView,
  resolveViewOpenPlan,
} from "./view-registry";

describe("view registry", () => {
  it("classifies native list, tab, and prefix views", () => {
    expect(isNativeListView("domains")).toBe(true);
    expect(isNativeListView("last-visited")).toBe(true);
    expect(isNativeTabView("domains")).toBe(false);
    expect(isNativeTabView("last-visited")).toBe(true);
    expect(isNativePrefixView("reorder-tabs")).toBe(true);
    expect(LIST_VIEW_TITLES["last-visited"]).toBe("Recent");
  });

  it("plans list opens with params and optional domain", () => {
    const params = new URLSearchParams({ domain: "example.test", workspaceId: "ws-1" });

    expect(resolveViewOpenPlan("domain-tabs", params)).toEqual({
      kind: "list",
      view: "domain-tabs",
      domain: "example.test",
      params: { domain: "example.test", workspaceId: "ws-1" },
    });
  });

  it("plans actions, prefixes, concrete loaders, and unsupported foreign popups", () => {
    expect(resolveViewOpenPlan("actions")).toEqual({ kind: "actions" });
    expect(resolveViewOpenPlan("split-view")).toEqual({ kind: "prefix", view: "split-view" });
    expect(resolveViewOpenPlan("tab-info")).toEqual({ kind: "loader", view: "tab-info", loader: "tab-info" });
    expect(resolveViewOpenPlan("extension-popup")).toEqual({ kind: "unsupported", view: "extension-popup" });
  });
});
