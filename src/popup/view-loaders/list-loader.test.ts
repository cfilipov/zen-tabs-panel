import { describe, expect, it } from "vitest";
import type { RecentsViewModel, ViewWindow } from "../runtime/tab-index-client";
import { loadNativeListWindow, loadRecentsViewModelWindow, type NativeListRow, type TabIndexClient } from "./list-loader";

function createClient(window: ViewWindow<NativeListRow>) {
  const calls: string[] = [];
  const client = {
    ensureStarted: async () => {
      calls.push("ensure");
      return true;
    },
    getWindow: async <Row extends NativeListRow>(
      view: string,
      offset: number,
      limit: number,
      params: Record<string, unknown>,
    ) => {
      calls.push(`window:${view}:${offset}:${limit}:${JSON.stringify(params)}`);
      return window as ViewWindow<Row>;
    },
  } as unknown as TabIndexClient;
  return { client, calls };
}

describe("list loader", () => {
  it("starts the tab index before requesting a virtual window", async () => {
    const expected = {
      version: 1,
      view: "domains",
      offset: 40,
      limit: 80,
      total: 3000,
      rows: [],
    };
    const { client, calls } = createClient(expected);

    const result = await loadNativeListWindow(client, {
      view: "domains",
      offset: 40,
      limit: 80,
      params: { sortAlpha: true },
    });

    expect(result).toBe(expected);
    expect(calls).toEqual(["ensure", 'window:domains:40:80:{"sortAlpha":true}']);
  });

  it("defaults params to an empty object", async () => {
    const { client, calls } = createClient({
      version: 1,
      view: "parent-tabs",
      offset: 0,
      limit: 80,
      total: 0,
      rows: [],
    });

    await loadNativeListWindow(client, { view: "parent-tabs", offset: 0, limit: 80 });

    expect(calls).toEqual(["ensure", "window:parent-tabs:0:80:{}"]);
  });

  it("hydrates deduplicated favicon refs", async () => {
    const icon = "data:image/png;base64,abc";
    const { client } = createClient({
      version: 1,
      view: "last-visited",
      offset: 0,
      limit: 80,
      total: 1,
      favicons: { f1: icon },
      rows: [{
        index: 0,
        domId: "tab-1",
        title: "Tab",
        domain: "example.test",
        workspaceId: "ws-1",
        pinned: false,
        essential: false,
        active: false,
        favIconUrl: "ztt-favicon:f1",
        pending: false,
      }],
    });

    const result = await loadNativeListWindow(client, { view: "last-visited", offset: 0, limit: 80 });

    expect("favIconUrl" in result.rows[0] && result.rows[0].favIconUrl).toBe(icon);
  });

  it("loads recents through the chrome-owned recents model", async () => {
    const calls: string[] = [];
    const icon = "data:image/png;base64,recents";
    const client = {
      ensureStarted: async () => {
        calls.push("ensure");
        return true;
      },
      getRecentsViewModel: async (
        offset: number,
        limit: number,
        params: Record<string, unknown>,
      ): Promise<RecentsViewModel> => {
        calls.push(`recents:${offset}:${limit}:${JSON.stringify(params)}`);
        return {
          version: 2,
          view: "last-visited",
          offset,
          limit,
          total: 1,
          favicons: { f1: icon },
          rows: [{
            index: 0,
            domId: "tab-1",
            title: "Recent",
            domain: "example.test",
            workspaceId: "ws-1",
            pinned: false,
            essential: false,
            active: false,
            favIconUrl: "ztt-favicon:f1",
            pending: false,
          }],
          model: {
            id: "recents",
            view: "last-visited",
            version: 2,
            rowIntents: [{ rowId: "tab-1", index: 0, chordKey: "1", action: "activate-tab" }],
          },
        };
      },
    } as unknown as TabIndexClient;

    const result = await loadRecentsViewModelWindow(client, {
      offset: 0,
      limit: 80,
      params: { workspaceId: "all" },
    });

    expect(calls).toEqual(["ensure", 'recents:0:80:{"workspaceId":"all"}']);
    expect(result.model.rowIntents).toEqual([{ rowId: "tab-1", index: 0, chordKey: "1", action: "activate-tab" }]);
    expect(result.rows[0].favIconUrl).toBe(icon);
  });
});
