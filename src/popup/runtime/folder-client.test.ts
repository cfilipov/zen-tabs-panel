import { describe, expect, it } from "vitest";
import { createFolderClient } from "./folder-client";

describe("folder client", () => {
  it("requests Zen tab folders", async () => {
    const sent: unknown[] = [];
    const client = createFolderClient(async <T>(message: unknown) => {
      sent.push(message);
      return [] as T;
    });

    await client.getFolders();

    expect(sent).toEqual([{ type: "get-folders" }]);
  });

  it("requests the chrome-owned folder view model", async () => {
    const sent: unknown[] = [];
    const client = createFolderClient(async <T>(message: unknown) => {
      sent.push(message);
      return { rows: [], selectedIndex: -1 } as T;
    });

    await client.getFoldersViewModel();

    expect(sent).toEqual([{ type: "get-folders-view-model" }]);
  });
});
