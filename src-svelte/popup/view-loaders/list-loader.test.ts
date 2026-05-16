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
});
