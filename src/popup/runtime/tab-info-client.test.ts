import { describe, expect, it } from "vitest";
import { createTabInfoClient } from "./tab-info-client";

describe("tab info client", () => {
  it("requests the completed tab info view model", async () => {
    const sent: unknown[] = [];
    const client = createTabInfoClient(async <T>(message: unknown) => {
      sent.push(message);
      return { info: null, visits: [], duplicates: [], workspaces: [], selectedIndex: -1 } as T;
    });

    await client.getTabInfoViewModel();

    expect(sent).toEqual([{ type: "get-tab-info-view-model" }]);
  });
});
