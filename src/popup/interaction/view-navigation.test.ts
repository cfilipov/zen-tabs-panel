import { describe, expect, it } from "vitest";
import { chromeNavigationMessage, encodeViewParams } from "./view-navigation";

describe("view navigation messages", () => {
  it("encodes URLSearchParams and plain records for chrome navigation", () => {
    expect(encodeViewParams(new URLSearchParams({ domain: "example.test" })))
      .toBe('{"domain":"example.test"}');
    expect(encodeViewParams({ workspaceId: "ws-1", sortAlpha: true }))
      .toBe('{"workspaceId":"ws-1","sortAlpha":true}');
    expect(encodeViewParams()).toBeUndefined();
  });

  it("uses navigate-back for actions and navigate-view for subviews", () => {
    expect(chromeNavigationMessage("actions")).toEqual({ type: "navigate-back" });
    expect(chromeNavigationMessage("domains", { sortAlpha: true }, 4, 9)).toEqual({
      type: "navigate-view",
      view: "domains",
      params: '{"sortAlpha":true}',
      inst: 4,
      readyGen: 9,
    });
  });
});
