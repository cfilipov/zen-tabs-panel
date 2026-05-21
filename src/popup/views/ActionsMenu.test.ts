import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ActionsMenu from "./ActionsMenu.svelte";
import type { ActionMenuItem, ActionSection } from "./actions-model";

function item(partial: Partial<ActionMenuItem> & Pick<ActionMenuItem, "id" | "label" | "badge">): ActionMenuItem {
  return {
    kind: "action",
    hotkey: partial.badge,
    isView: false,
    page: 1,
    ...partial,
  };
}

function testSections(): ActionSection[] {
  return [
    {
      id: "navigate",
      label: "Navigate",
      page: 1,
      navigateGrid: true,
      items: [
        item({ id: "go-to-previous-tab", label: "Previous", badge: "P", preview: { title: "Prev", favIconUrl: "", domId: "tab-prev" } }),
        item({ id: "go-to-parent-tab", label: "Parent", badge: "T", preview: { title: "Parent", favIconUrl: "", domId: "tab-parent" } }),
      ],
    },
    { id: "this-tab", label: "This tab", page: 1, column: true, stack: true, items: [item({ id: "tab-info", label: "Info", badge: "I" })] },
    { id: "tab-actions", label: "Tab actions", page: 1, column: true, stack: true, items: [item({ id: "unload-tab", label: "Unload", badge: "U" })] },
    { id: "all-tabs", label: "All tabs", page: 1, column: true, items: [item({ id: "last-visited", label: "Recents", badge: "R" })] },
    { id: "organize", label: "Organize", page: 1, column: true, items: [item({ id: "reorder-tabs", label: "Reorder", badge: "O" })] },
    {
      id: "workspaces",
      label: "Workspaces",
      page: 1,
      column: true,
      scrollable: true,
      items: [
        item({ id: "workspace-switch:ws-1", kind: "workspace-switch", label: "No Icon", badge: "1", workspaceId: "ws-1", workspaceIndex: 0, workspaceIconHtml: "", count: 4 }),
        item({ id: "workspace-switch:ws-2", kind: "workspace-switch", label: "Active", badge: "2", workspaceId: "ws-2", workspaceIndex: 1, workspaceIconHtml: "<svg></svg>", count: 7, disabled: true }),
      ],
    },
    {
      id: "this-page",
      label: "This page",
      page: 2,
      column: true,
      items: [item({ id: "reload-skip-cache", label: "Hard reload", badge: "⇧L", hotkey: "Shift+L", page: 2 })],
    },
  ];
}

describe("ActionsMenu", () => {
  it("renders first-page action labels and badges from the model", () => {
    render(ActionsMenu, {
      props: {
        sections: testSections(),
        currentPage: 1,
      },
    });

    expect(screen.getByText("Previous")).toBeTruthy();
    expect(screen.getAllByText("Parent").length).toBeGreaterThan(0);
    expect(screen.getByText("P")).toBeTruthy();
    expect(screen.getByText("T")).toBeTruthy();
  });

  it("renders second-page shift badges", () => {
    const { container } = render(ActionsMenu, {
      props: {
        sections: testSections(),
        currentPage: 2,
      },
    });

    expect(container.querySelectorAll(".actions-page")).toHaveLength(2);
    const page2 = container.querySelector('[data-page="2"]');
    expect(page2?.textContent).toContain("Hard reload");
    expect(page2?.textContent).toContain("⇧L");
  });

  it("only suppresses page-slide animation when skip animations is enabled", () => {
    const animated = render(ActionsMenu, {
      props: {
        sections: testSections(),
        currentPage: 2,
      },
    });

    expect(animated.container.querySelector(".actions-pager")?.classList.contains("no-anim")).toBe(false);
    animated.unmount();

    const skipped = render(ActionsMenu, {
      props: {
        sections: testSections(),
        currentPage: 2,
        skipAnimations: true,
      },
    });

    expect(skipped.container.querySelector(".actions-pager")?.classList.contains("no-anim")).toBe(true);
  });

  it("groups consecutive column sections into the vanilla actions grid", () => {
    const { container } = render(ActionsMenu, {
      props: {
        sections: testSections(),
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
    const sections = testSections().map((section) => section.id === "navigate" && section.page === 1
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

  it("renders workspace switcher rows with vanilla fallback dot and scroll affordance", () => {
    const { container } = render(ActionsMenu, {
      props: {
        sections: testSections(),
        currentPage: 1,
      },
    });

    const fallbackRow = container.querySelector('[data-id="workspace-switch:ws-1"]');
    const activeRow = container.querySelector('[data-id="workspace-switch:ws-2"]');

    expect(fallbackRow?.querySelector(".item-icon-placeholder")?.textContent).toBe("○");
    expect(activeRow?.classList.contains("ws-active")).toBe(true);
    expect(container.querySelector(".section-column.scrollable-column .section-scroll-fade")).toBeTruthy();
  });
});
