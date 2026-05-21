import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import TabInfoView from "./TabInfoView.svelte";
import type { HistoryVisit, TabInfo } from "../runtime/tab-info-client";

function tabInfo(): TabInfo {
  return {
    domId: "tab-1",
    title: "Example tab",
    url: "https://example.com/path",
    favIconUrl: "",
    pinned: false,
    workspaceId: null,
    lastAccessed: Date.now(),
    status: "complete",
    sessionEntries: [],
    memory: 0,
    cpuTime: null,
    duplicateDomIds: [],
    panelTabUuid: null,
    panelParentUuid: null,
    panelStats: null,
    parentTitle: null,
    parentDomId: null,
    parentFavIconUrl: null,
  };
}

describe("TabInfoView", () => {
  it("renders visits that share the same timestamp", () => {
    const visits: HistoryVisit[] = [
      { visitTime: 1_700_000_000_000, transition: "link", url: "https://example.com/a" },
      { visitTime: 1_700_000_000_000, transition: "typed", url: "https://example.com/b" },
    ];

    const { container } = render(TabInfoView, {
      props: {
        info: tabInfo(),
        visits,
        duplicates: [],
        workspaces: [],
      },
    });

    expect(screen.getByText("Example tab")).toBeTruthy();
    expect(container.querySelectorAll(".info-history-row")).toHaveLength(2);
  });
});
