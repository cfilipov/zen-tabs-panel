import { describe, expect, it } from "vitest";
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

  it("uses the same display format as the legacy badges", () => {
    expect(displayKey("Shift+T")).toBe("⇧T");
    expect(displayKey(",")).toBe(",");
    expect(displayKey(null)).toBe("");
  });
});
