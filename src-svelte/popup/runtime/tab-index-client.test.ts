import { describe, expect, it } from "vitest";
import { createTabIndexClient } from "./tab-index-client";

describe("tab index client", () => {
  it("sends bounded window requests", async () => {
    const sent: unknown[] = [];
    const client = createTabIndexClient(async <T>(message: unknown) => {
      sent.push(message);
      return { version: 1, view: "last-visited", offset: 20, limit: 30, total: 3000, rows: [] } as T;
    });

    await client.getWindow("last-visited", 20, 30, { workspaceId: "all" });

    expect(sent).toEqual([
      { type: "tab-index:get-window", view: "last-visited", offset: 20, limit: 30, params: { workspaceId: "all" } },
    ]);
  });

  it("keeps row-target lookup separate from full row transfer", async () => {
    const client = createTabIndexClient(async <T>(message: unknown) => {
      expect(message).toEqual({ type: "tab-index:get-row-target", domId: "tab-1" });
      return { domId: "tab-1", workspaceId: "ws", url: "https://example.com", title: "Example" } as T;
    });

    await expect(client.getRowTarget("tab-1")).resolves.toMatchObject({ domId: "tab-1" });
  });

  it("prefers the direct experiment API with JSON-encoded params when available", async () => {
    const calls: unknown[] = [];
    const client = createTabIndexClient(
      async () => {
        throw new Error("message fallback should not be used");
      },
      {
        ensureIndexStarted: async () => true,
        getViewSummary: async () => ({ version: 1, view: "domains", total: 1, rowType: "domain" }),
        getViewWindow: async <T>(view: string, offset: number, limit: number, paramsJson?: string) => {
          calls.push({ view, offset, limit, paramsJson });
          return { version: 1, view, offset, limit, total: 1, rows: [] } as T;
        },
        getRowTarget: async () => null,
        getWorkspaceTabCounts: async () => ({}),
        getActionsSnapshot: async () => ({
          version: 1,
          currentTabHasParent: false,
          currentTabIsPinned: false,
          childTabCount: 0,
          siblingTabCount: 0,
          parentTabCount: 0,
          unvisitedTabCount: 0,
          domainCount: 0,
          duplicateGroupCount: 0,
          workspaceTabCounts: {},
          previews: {},
        }),
      },
    );

    await client.getWindow("domain-tabs", 0, 5, { domain: "example.com" });

    expect(calls).toEqual([
      { view: "domain-tabs", offset: 0, limit: 5, paramsJson: "{\"domain\":\"example.com\"}" },
    ]);
  });
});
