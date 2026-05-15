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
});
