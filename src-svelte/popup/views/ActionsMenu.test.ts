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
    const { container } = render(ActionsMenu, {
      props: {
        sections: buildActionsMenuModel(),
        currentPage: 2,
      },
    });

    expect(container.querySelectorAll(".actions-page")).toHaveLength(2);
    const page2 = container.querySelector('[data-page="2"]');
    expect(page2?.textContent).toContain("Hard reload");
    expect(page2?.textContent).toContain("⇧L");
  });

  it("groups consecutive column sections into the vanilla actions grid", () => {
    const { container } = render(ActionsMenu, {
      props: {
        sections: buildActionsMenuModel(),
        currentPage: 1,
      },
    });

    const rows = container.querySelectorAll('[data-page="1"] > .sections-row');
    expect(rows).toHaveLength(1);

    const columns = Array.from(rows[0].children).filter((child) =>
      child.classList.contains("section-column")
    );
    expect(columns).toHaveLength(4);
    expect(columns[0].querySelectorAll(".list-section-header")).toHaveLength(2);
    expect(columns[0].textContent).toContain("This tab");
    expect(columns[0].textContent).toContain("Tab actions");
  });

  it("renders navigate entries as preview cells", () => {
    const sections = buildActionsMenuModel().map((section) => section.id === "navigate" && section.page === 1
      ? {
          ...section,
          items: section.items.map((item) => item.id === "go-to-previous-tab"
            ? { ...item, preview: { title: "Previous tab title", favIconUrl: "", domId: "tab-1" } }
            : item),
        }
      : section);
    const { container } = render(ActionsMenu, {
      props: {
        sections,
        currentPage: 1,
      },
    });

    expect(container.querySelector(".navigate-cell")).toBeTruthy();
    expect(screen.getByText("Previous tab title")).toBeTruthy();
  });
});
