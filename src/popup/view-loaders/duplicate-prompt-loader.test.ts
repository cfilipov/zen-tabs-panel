import { describe, expect, it } from "vitest";
import { loadDuplicatePromptView } from "./duplicate-prompt-loader";
import type { DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";

const tab = (domId: string): TabIndexRow => ({
  index: 0,
  id: null,
  domId,
  title: "Tab",
  url: "https://example.test/path",
  domain: "example.test",
  workspaceId: null,
  pinned: false,
  essential: false,
  active: false,
  favIconUrl: "",
  pending: false,
});

const group: DuplicateGroupRow = {
  kind: "duplicate-group",
  url: "https://example.test/path",
  title: "Example",
  domain: "example.test",
  favIconUrl: "",
  tabs: [tab("tab-1"), tab("tab-2")],
};

function clients(groups: DuplicateGroupRow[] = []) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    tabIndex: {
      getDuplicateGroups: async (params?: Record<string, unknown>) => {
        calls.push(params || {});
        return groups;
      },
    },
    workspace: { getWorkspacesWithIcons: async () => [] },
  };
}

describe("duplicate prompt loader", () => {
  it("prefers the chrome-owned duplicate prompt model", async () => {
    const params = new URLSearchParams({
      url: group.url,
      domId: "tab-2",
    });
    const calls: string[] = [];
    const tabIndex = {
      getDuplicateGroups: async () => { throw new Error("fallback should not run"); },
      getDuplicatePromptViewModel: async (url: string, domId?: string | null) => {
        calls.push(`${url}:${domId}`);
        return {
          version: 7,
          view: "duplicate-prompt" as const,
          url,
          domId: domId || null,
          group,
          selectedIndex: -1,
          model: {
            id: "duplicate-prompt" as const,
            view: "duplicate-prompt" as const,
            rowIntents: [{ rowId: "tab-1", index: 0, chordKey: "1", action: "activate-tab" }],
          },
        };
      },
    };

    await expect(loadDuplicatePromptView(tabIndex, { getWorkspacesWithIcons: async () => [] }, params))
      .resolves.toMatchObject({
        version: 7,
        url: group.url,
        domId: "tab-2",
        group,
        model: { id: "duplicate-prompt" },
      });
    expect(calls).toEqual([`${group.url}:tab-2`]);
  });

  it("reads the duplicate URL and existing tab dom id from URL params", async () => {
    const params = new URLSearchParams({
      url: group.url,
      domId: "tab-2",
    });
    const { calls, tabIndex, workspace } = clients([group]);

    await expect(loadDuplicatePromptView(tabIndex, workspace, params)).resolves.toEqual({
      url: group.url,
      domId: "tab-2",
      group: { ...group, tabs: [group.tabs[1], group.tabs[0]] },
      workspaces: [],
      selectedIndex: -1,
    });
    expect(calls).toEqual([{ url: group.url, includeSingleton: true }]);
  });

  it("reads warm-rearm params from a plain object", async () => {
    const { tabIndex, workspace } = clients();
    await expect(loadDuplicatePromptView(tabIndex, workspace, {
      url: "https://example.test/warm",
      domId: "tab-2",
    })).resolves.toEqual({
      url: "https://example.test/warm",
      domId: "tab-2",
      group: null,
      workspaces: [],
      selectedIndex: -1,
    });
  });

  it("defaults missing values to the empty prompt state", async () => {
    const { tabIndex, workspace } = clients();
    await expect(loadDuplicatePromptView(tabIndex, workspace, new URLSearchParams())).resolves.toEqual({
      url: "",
      domId: null,
      group: null,
      workspaces: [],
      selectedIndex: -1,
    });
  });
});
