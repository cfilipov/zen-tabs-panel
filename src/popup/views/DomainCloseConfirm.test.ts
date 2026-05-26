import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import DomainCloseConfirm from "./DomainCloseConfirm.svelte";

afterEach(cleanup);

describe("DomainCloseConfirm", () => {
  it("shows close counts and the pinned-inclusive option when pinned tabs can close", () => {
    render(DomainCloseConfirm, {
      props: {
        domain: "example.com",
        count: 5,
        unpinnedCount: 3,
        pinnedCount: 2,
      },
    });

    expect(screen.getByText("Close unpinned tabs")).toBeTruthy();
    expect(screen.getByText("Close all tabs")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("hides the pinned-inclusive option when no pinned tabs can close", () => {
    render(DomainCloseConfirm, {
      props: {
        domain: "example.com",
        count: 3,
        unpinnedCount: 3,
        pinnedCount: 0,
      },
    });

    expect(screen.getByText("Close unpinned tabs")).toBeTruthy();
    expect(screen.queryByText("Close all tabs")).toBeNull();
  });
});
