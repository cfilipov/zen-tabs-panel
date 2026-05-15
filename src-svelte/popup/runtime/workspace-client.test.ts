import { describe, expect, it } from "vitest";
import { createWorkspaceClient } from "./workspace-client";

describe("workspace client", () => {
  it("requests workspaces with inline icons", async () => {
    const sent: unknown[] = [];
    const client = createWorkspaceClient(async <T>(message: unknown) => {
      sent.push(message);
      return [] as T;
    });

    await client.getWorkspacesWithIcons();

    expect(sent).toEqual([{ type: "get-workspaces-with-icons" }]);
  });
});
