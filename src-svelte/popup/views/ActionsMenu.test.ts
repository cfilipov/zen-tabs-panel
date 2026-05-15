import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ActionsMenu from "./ActionsMenu.svelte";
import { buildActionsMenuModel } from "./actions-model";

describe("ActionsMenu", () => {
  it("renders first-page action labels and badges from the model", () => {
    render(ActionsMenu, {
      props: {
        sections: buildActionsMenuModel(),
        currentPage: 1,
      },
    });

    expect(screen.getByText("Previous")).toBeTruthy();
    expect(screen.getByText("Parent")).toBeTruthy();
    expect(screen.getByText("P")).toBeTruthy();
    expect(screen.getByText("T")).toBeTruthy();
  });

  it("renders second-page shift badges", () => {
    render(ActionsMenu, {
      props: {
        sections: buildActionsMenuModel(),
        currentPage: 2,
      },
    });

    expect(screen.getByText("Hard reload")).toBeTruthy();
    expect(screen.getByText("⇧L")).toBeTruthy();
  });
});
