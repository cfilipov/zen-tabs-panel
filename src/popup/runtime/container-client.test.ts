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

  it("requests the chrome-owned container view model", async () => {
    const client = createContainerClient({
      getContainersViewModel: async () => ({
        version: 1,
        view: "open-in-container",
        rows: [],
        selectedIndex: -1,
        model: { id: "containers", view: "open-in-container", rowIntents: [] },
      }),
    });

    await expect(client.getContainersViewModel()).resolves.toMatchObject({
      view: "open-in-container",
      model: { id: "containers" },
    });
  });
});
