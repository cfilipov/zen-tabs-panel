import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuplicateGroupRow, TabIndexRow } from "../runtime/tab-index-client";
import DuplicatePrompt from "./DuplicatePrompt.svelte";

afterEach(cleanup);

const tab = (domId: string, active = false): TabIndexRow => ({
  index: 0,
  id: null,
  domId,
  title: "Tab",
  url: "https://example.com/",
  domain: "example.com",
  workspaceId: "main",
  pinned: false,
  essential: false,
  active,
  favIconUrl: "",
  pending: false,
});

const group: DuplicateGroupRow = {
  kind: "duplicate-group",
  url: "https://example.com/",
  title: "Example",
  domain: "example.com",
  favIconUrl: "",
  tabs: [tab("existing-tab"), tab("other-tab")],
};

describe("DuplicatePrompt", () => {
  it("previews the existing tab while hovering the switch option", async () => {
    const onpreview = vi.fn();
    const onclearpreview = vi.fn();
    render(DuplicatePrompt, {
      props: {
        url: "https://example.com/",
        existingDomId: "existing-tab",
        selectedIndex: -1,
        onpreview,
        onclearpreview,
      },
    });

    await fireEvent.mouseEnter(screen.getByRole("button", { name: /switch to existing tab/i }));
    expect(onpreview).toHaveBeenCalledWith("existing-tab");

    await fireEvent.mouseLeave(screen.getByRole("button", { name: /switch to existing tab/i }));
    expect(onclearpreview).toHaveBeenCalledOnce();
  });

  it("does not preview non-tab prompt choices", async () => {
    const onpreview = vi.fn();
    render(DuplicatePrompt, {
      props: {
        url: "https://example.com/",
        existingDomId: "existing-tab",
        selectedIndex: -1,
        onpreview,
      },
    });

    await fireEvent.mouseEnter(screen.getByRole("button", { name: /open anyway/i }));
    expect(onpreview).not.toHaveBeenCalled();
  });

  it("renders the combined open-and-close option between open anyway and cancel", () => {
    render(DuplicatePrompt, {
      props: {
        url: "https://example.com/",
        existingDomId: "existing-tab",
      },
    });

    const labels = screen.getAllByRole("button").map((button) => button.textContent || "");
    expect(labels[1]).toContain("Open anyway");
    expect(labels[2]).toContain("Open and close others");
    expect(labels[2]).toContain("W");
    expect(labels[3]).toContain("Cancel");
  });

  it("renders duplicate rows below the action list", async () => {
    const onpreview = vi.fn();
    const ontabactivate = vi.fn();
    const onclose = vi.fn();

    render(DuplicatePrompt, {
      props: {
        url: "https://example.com/",
        existingDomId: "existing-tab",
        group,
        workspaces: [{ uuid: "main", name: "Main", svgContent: "", isActive: true }],
        onpreview,
        ontabactivate,
        onclose,
      },
    });

    expect(screen.queryByText("https://example.com/")).not.toBeNull();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);

    await fireEvent.mouseEnter(screen.getByRole("button", { name: /main .*1/i }));
    expect(onpreview).toHaveBeenCalledWith("existing-tab");

    await fireEvent.click(screen.getByRole("button", { name: /main .*2/i }));
    expect(ontabactivate).toHaveBeenCalledWith(group.tabs[1], 1);

    await fireEvent.click(screen.getAllByTitle("Close tab")[0]);
    expect(onclose).toHaveBeenCalledWith(group.tabs[0]);
  });
});
