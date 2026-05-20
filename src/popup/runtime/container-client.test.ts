import { describe, expect, it } from "vitest";
import { createContainerClient, normalizeContainer } from "./container-client";

describe("container client", () => {
  it("normalizes Firefox container identity rows", () => {
    expect(normalizeContainer({
      cookieStoreId: "firefox-container-3",
      name: "Work",
      colorCode: "#00f",
      iconUrl: "resource://usercontext-content/briefcase.svg",
    })).toEqual({
      cookieStoreId: "firefox-container-3",
      userContextId: 3,
      name: "Work",
      colorCode: "#00f",
      iconUrl: "resource://usercontext-content/briefcase.svg",
    });
  });

  it("queries container rows through the supplied model source", async () => {
    const client = createContainerClient({
      getContainers: async () => [{ cookieStoreId: "firefox-container-7", name: "Personal" }],
    });

    await expect(client.getContainers()).resolves.toMatchObject([
      { userContextId: 7, name: "Personal" },
    ]);
  });
});
