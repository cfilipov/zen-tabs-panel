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
