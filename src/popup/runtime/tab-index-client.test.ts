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

  it("loads the chrome-owned duplicate groups model through the message fallback", async () => {
    const sent: unknown[] = [];
    const client = createTabIndexClient(async <T>(message: unknown) => {
      sent.push(message);
      return {
        version: 1,
        view: "duplicates",
        groups: [],
        workspaces: [],
        workspaceFilter: "ws-1",
        selectedIndex: -1,
        model: { id: "duplicates", view: "duplicates", rowIntents: [] },
      } as T;
    });

    await client.getDuplicateGroupsViewModel("ws-1");

    expect(sent).toEqual([
      { type: "tab-index:get-duplicate-groups-model", workspaceFilter: "ws-1" },
    ]);
  });

  it("loads the chrome-owned actions model through the message fallback", async () => {
    const sent: unknown[] = [];
    const client = createTabIndexClient(async <T>(message: unknown) => {
      sent.push(message);
      return {
        version: 1,
        view: "actions",
        sections: [],
        prefixItemsByView: {},
        workspaces: [],
        workspaceTabCounts: {},
        extensions: [],
        iconHtmlById: {},
        previewsById: {},
        counts: {},
        disabledIds: [],
        selectedIndex: -1,
      } as T;
    });

    await client.getActionsViewModel();

    expect(sent).toEqual([{ type: "tab-index:get-actions-model" }]);
  });

  it("loads the chrome-owned duplicate prompt model through the message fallback", async () => {
    const sent: unknown[] = [];
    const client = createTabIndexClient(async <T>(message: unknown) => {
      sent.push(message);
      return {
        version: 1,
        view: "duplicate-prompt",
        url: "https://example.test",
        domId: "tab-1",
        group: null,
        selectedIndex: -1,
        model: { id: "duplicate-prompt", view: "duplicate-prompt", rowIntents: [] },
      } as T;
    });

    await client.getDuplicatePromptViewModel("https://example.test", "tab-1");

    expect(sent).toEqual([
      { type: "tab-index:get-duplicate-prompt-model", url: "https://example.test", domId: "tab-1" },
    ]);
  });

  it("loads the chrome-owned recents model through the message fallback", async () => {
    const sent: unknown[] = [];
    const client = createTabIndexClient(async <T>(message: unknown) => {
      sent.push(message);
      return {
        version: 1,
        view: "last-visited",
        offset: 0,
        limit: 80,
        total: 0,
        rows: [],
        model: { id: "recents", view: "last-visited", rowIntents: [] },
      } as T;
    });

    await client.getRecentsViewModel(0, 80, { workspaceId: "all" });

    expect(sent).toEqual([
      { type: "tab-index:get-recents-model", offset: 0, limit: 80, params: { workspaceId: "all" } },
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
