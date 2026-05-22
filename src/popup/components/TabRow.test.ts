import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TabIndexRow } from "../runtime/tab-index-client";
import TabRow from "./TabRow.svelte";

afterEach(cleanup);

const row: TabIndexRow = {
  index: 0,
  id: null,
  domId: "tab-1",
  title: "Example tab",
  url: "https://example.com/",
  domain: "example.com",
  workspaceId: "main",
  pinned: false,
  essential: false,
  active: false,
  favIconUrl: "",
  pending: false,
};

describe("TabRow", () => {
  it("closes from the close affordance without activating the row", async () => {
    const onactivate = vi.fn();
    const onclose = vi.fn();

    render(TabRow, {
      props: {
        row,
        index: 3,
        onactivate,
        onclose,
      },
    });

    await fireEvent.click(screen.getByTitle("Close tab"));

    expect(onclose).toHaveBeenCalledWith(row);
    expect(onactivate).not.toHaveBeenCalled();
  });
});
