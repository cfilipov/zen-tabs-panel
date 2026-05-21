import { describe, expect, it } from "vitest";
import { createProfileClient } from "./profile-client";

describe("profile client", () => {
  it("requests the chrome-owned profiles view model", async () => {
    const sent: unknown[] = [];
    const client = createProfileClient(async <T>(message: unknown) => {
      sent.push(message);
      return { rows: [], selectedIndex: -1 } as T;
    });

    await client.getProfilesViewModel();

    expect(sent).toEqual([{ type: "get-profiles-view-model" }]);
  });
});
