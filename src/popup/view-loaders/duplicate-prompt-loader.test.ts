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

describe("duplicate prompt loader", () => {
  it("loads the chrome-owned duplicate prompt model", async () => {
    const params = new URLSearchParams({
      url: group.url,
      domId: "tab-2",
    });
    const calls: string[] = [];
    const tabIndex = {
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

  it("reads warm-rearm params from a plain object", async () => {
    await expect(loadDuplicatePromptView(
      {
        getDuplicatePromptViewModel: async (url: string, domId?: string | null) => ({
          version: 1,
          view: "duplicate-prompt" as const,
          url,
          domId: domId || null,
          group: null,
          selectedIndex: -1,
          model: { id: "duplicate-prompt" as const, view: "duplicate-prompt" as const, rowIntents: [] },
        }),
      },
      { getWorkspacesWithIcons: async () => [] },
      { url: "https://example.test/warm", domId: "tab-2" },
    )).resolves.toMatchObject({
      url: "https://example.test/warm",
      domId: "tab-2",
      group: null,
      selectedIndex: -1,
    });
  });
});
