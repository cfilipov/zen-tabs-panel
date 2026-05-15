import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import VirtualListFixture from "./VirtualListFixture.svelte";

describe("VirtualList", () => {
  it("renders only the supplied window while preserving full scroll height", () => {
    render(VirtualListFixture, {
      props: {
        rows: ["one", "two", "three"],
        total: 3000,
        offset: 120,
        rowHeight: 40,
      },
    });

    const list = screen.getByText("one").closest(".virtual-list");
    expect(list?.getAttribute("data-total")).toBe("3000");
    expect(list?.getAttribute("data-offset")).toBe("120");
    expect(list?.getAttribute("style")).toContain("height: 120000px");
    expect(screen.queryByText("four")).toBeNull();
  });
});
