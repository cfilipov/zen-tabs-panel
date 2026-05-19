import { describe, expect, it } from "vitest";
import { createHistoryClient } from "./history-client";

describe("history client", () => {
  it("requests navigation history and recently closed rows by message type", async () => {
    const sent: unknown[] = [];
    const client = createHistoryClient(async <T>(message: unknown) => {
      sent.push(message);
      return [] as T;
    });

    await client.getNavigationHistory();
    await client.getRecentlyClosed();

    expect(sent).toEqual([
      { type: "get-navigation-history" },
      { type: "get-recently-closed" },
    ]);
  });
});
