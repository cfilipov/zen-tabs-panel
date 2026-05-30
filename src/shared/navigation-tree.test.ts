import { describe, expect, it } from "vitest";
import { ACTION_SECTIONS } from "./action-sections";
import { NAVIGATION_TREE, WORKSPACE_DIGIT_CHORDS, displayKey } from "./navigation-tree";
import type { NavNode } from "./types";

function flatten(nodes: readonly NavNode[]): NavNode[] {
  const out: NavNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.kind === "prefix") out.push(...node.children);
  }
  return out;
}

describe("navigation tree", () => {
  it("has unique ids", () => {
    const ids = flatten(NAVIGATION_TREE).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique top-level chords", () => {
    const chords = NAVIGATION_TREE.map((node) => node.chord);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("has unique child chords within each prefix", () => {
    for (const node of NAVIGATION_TREE) {
      if (node.kind !== "prefix") continue;
      const chords = node.children.map((child) => child.chord);
      expect(new Set(chords).size, node.id).toBe(chords.length);
    }
  });

  it("keeps workspace digit chords in keyboard order", () => {
    expect(WORKSPACE_DIGIT_CHORDS).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);
  });

  it("keeps actions menu section ids backed by navigation nodes", () => {
    const ids = new Set(flatten(NAVIGATION_TREE).map((node) => node.id));
    const missing = ACTION_SECTIONS
      .flatMap((section) => section.actionIds)
      .filter((id) => !ids.has(id));

    expect(missing).toEqual([]);
  });

  it("keeps the page-two new-tab actions on their assigned chords", () => {
    const byId = new Map(flatten(NAVIGATION_TREE).map((node) => [node.id, node]));

    expect(byId.get("mark-tabs-new")?.chord).toBe("Shift+N");
    expect(byId.get("open-in-container")?.chord).toBe("Shift+X");
    expect(byId.get("move-to-parent")?.chord).toBe("Shift+Q");
  });

  it("keeps close-and-select paired actions adjacent", () => {
    const menu = NAVIGATION_TREE.find((node) => node.id === "close-and-select");
    expect(menu?.kind).toBe("prefix");
    if (!menu || menu.kind !== "prefix") return;

    expect(menu.children.map((child) => [child.id, child.chord, child.label])).toEqual([
      ["close-and-select-previous", "P", "Previous"],
      ["close-and-select-parent", "T", "Parent"],
      ["close-and-select-prev-sibling", "Shift+C", "Previous sibling"],
      ["close-and-select-next-sibling", "C", "Next sibling"],
      ["close-and-select-prev-vertical", "J", "Above"],
      ["close-and-select-next-vertical", "K", "Below"],
      ["close-and-select-unvisited-newest", "G", "Newest unvisited"],
      ["close-and-select-unvisited-oldest", "Shift+G", "Oldest unvisited"],
      ["close-and-select-default", "W", "Default"],
    ]);
  });

  it("uses the same display format as the legacy badges", () => {
    expect(displayKey("Shift+T")).toBe("⇧T");
    expect(displayKey(",")).toBe(",");
    expect(displayKey(null)).toBe("");
  });
});
