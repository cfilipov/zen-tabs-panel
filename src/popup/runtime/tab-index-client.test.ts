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

  it("uses an explicitly injected API with JSON-encoded params for unit seams", async () => {
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
        getActiveRow: async () => null,
        getRowsByDomIds: async () => [],
        getWorkspaceTabCounts: async () => ({}),
        getDuplicateGroups: async () => [],
        getActionsSnapshot: async () => ({
          version: 1,
          currentTabHasParent: false,
          currentTabIsPinned: false,
          currentTabCanReaderMode: false,
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

  it("does not discover browser.zenWorkspaces from the popup global", async () => {
    const globals = globalThis as typeof globalThis & {
      browser?: {
        zenWorkspaces?: {
          ensureIndexStarted: () => Promise<boolean>;
        };
      };
    };
    const previousBrowser = globals.browser;
    const directCalls: string[] = [];
    globals.browser = {
      zenWorkspaces: {
        ensureIndexStarted: async () => {
          directCalls.push("ensureIndexStarted");
          return true;
        },
      },
    };

    try {
      const sent: unknown[] = [];
      const client = createTabIndexClient(async <T>(message: unknown) => {
        sent.push(message);
        return true as T;
      });

      await client.ensureStarted();

      expect(directCalls).toEqual([]);
      expect(sent).toEqual([{ type: "tab-index:ensure-started" }]);
    } finally {
      if (previousBrowser === undefined) {
        delete globals.browser;
      } else {
        globals.browser = previousBrowser;
      }
    }
  });

  it("loads duplicate groups through the message fallback", async () => {
    const sent: unknown[] = [];
    const client = createTabIndexClient(async <T>(message: unknown) => {
      sent.push(message);
      return [] as T;
    });

    await client.getDuplicateGroups({ workspaceId: "ws-1" });

    expect(sent).toEqual([
      { type: "tab-index:get-duplicate-groups", params: { workspaceId: "ws-1" } },
    ]);
  });

  it("loads active and dom-id rows through focused tab-index requests", async () => {
    const sent: unknown[] = [];
    const client = createTabIndexClient(async <T>(message: unknown) => {
      sent.push(message);
      return [] as T;
    });

    await client.getActiveRow();
    await client.getRowsByDomIds(["tab-1", "tab-2"]);

    expect(sent).toEqual([
      { type: "tab-index:get-active-row" },
      { type: "tab-index:get-rows-by-dom-ids", domIds: ["tab-1", "tab-2"] },
    ]);
  });
});
