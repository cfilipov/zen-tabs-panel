import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DuplicatePrompt from "./DuplicatePrompt.svelte";

afterEach(cleanup);

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
});
