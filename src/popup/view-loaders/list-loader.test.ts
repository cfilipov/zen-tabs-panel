import { describe, expect, it } from "vitest";
import type { ViewWindow } from "../runtime/tab-index-client";
import { loadNativeListWindow, type NativeListRow, type TabIndexClient } from "./list-loader";

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
});
