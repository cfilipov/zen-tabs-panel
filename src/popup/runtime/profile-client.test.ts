import { describe, expect, it } from "vitest";
import { createProfileClient } from "./profile-client";

describe("profile client", () => {
  it("requests Zen profiles", async () => {
    const sent: unknown[] = [];
    const client = createProfileClient(async <T>(message: unknown) => {
      sent.push(message);
      return [] as T;
    });

    await client.getProfiles();

    expect(sent).toEqual([{ type: "get-profiles" }]);
  });
});
