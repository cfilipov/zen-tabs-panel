import { describe, expect, it } from "vitest";
import { loadTabInfoView } from "./tab-info-loader";

describe("tab info loader", () => {
  it("loads the completed tab info view model", async () => {
    const result = await loadTabInfoView(
      {},
      {
        getTabInfoViewModel: async () => ({
          info: {
            domId: "tab-1",
            title: "Example",
            url: "https://example.test",
            favIconUrl: "",
            pinned: false,
            workspaceId: "ws-1",
            lastAccessed: 0,
            status: "loaded",
            sessionEntries: [],
            memory: null,
            cpuTime: null,
            duplicateDomIds: [],
            panelTabUuid: null,
            panelParentUuid: null,
            panelStats: null,
            parentTitle: null,
            parentDomId: null,
            parentFavIconUrl: null,
          },
          visits: [],
          duplicates: [],
          workspaces: [{ uuid: "ws-1", name: "One", svgContent: "", isActive: true }],
          selectedIndex: -1,
        }),
      },
      {},
    );

    expect(result.info?.domId).toBe("tab-1");
    expect(result.workspaces[0]?.uuid).toBe("ws-1");
  });
});
