import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import Badge from "./Badge.svelte";

describe("Badge", () => {
  it("renders a single key as one badge", () => {
    const { container } = render(Badge, { props: { value: "P" } });

    expect(container.querySelectorAll(".item-badge")).toHaveLength(1);
    expect(container.querySelector(".item-badge")?.textContent).toBe("P");
    expect(container.querySelector(".item-badge-sequence")).toBeNull();
  });

  it("splits command chord paths into separate key boxes", () => {
    const { container } = render(Badge, { props: { value: "⌘. O D" } });
    const sequence = container.querySelector(".item-badge-sequence");
    const badges = Array.from(container.querySelectorAll(".item-badge"));

    expect(sequence?.getAttribute("aria-label")).toBe("⌘. O D");
    expect(badges.map((badge) => badge.textContent)).toEqual(["⌘.", "O", "D"]);
  });
});
