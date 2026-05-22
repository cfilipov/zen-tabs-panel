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

  it("requests Zen's built-in workspace icons", async () => {
    const sent: unknown[] = [];
    const client = createWorkspaceClient(async <T>(message: unknown) => {
      sent.push(message);
      return [] as T;
    });

    await client.getZenWorkspaceIcons();

    expect(sent).toEqual([{ type: "get-zen-workspace-icons" }]);
  });

  it("sets the active workspace icon by kind and value", async () => {
    const sent: unknown[] = [];
    const client = createWorkspaceClient(async <T>(message: unknown) => {
      sent.push(message);
      return { success: true } as T;
    });

    await client.setActiveWorkspaceIcon("lucide", "briefcase");

    expect(sent).toEqual([{ type: "set-active-workspace-icon", kind: "lucide", value: "briefcase" }]);
  });

  it("gets and sets the active workspace name", async () => {
    const sent: unknown[] = [];
    const client = createWorkspaceClient(async <T>(message: unknown) => {
      sent.push(message);
      return { name: "Main" } as T;
    });

    await client.getActiveWorkspaceName();
    await client.setActiveWorkspaceName("Focus");

    expect(sent).toEqual([
      { type: "get-active-workspace-name" },
      { type: "set-active-workspace-name", name: "Focus" },
    ]);
  });
});
