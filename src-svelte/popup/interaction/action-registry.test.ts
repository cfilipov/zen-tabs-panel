import { describe, expect, it } from "vitest";
import { NAVIGATION_TREE } from "../../shared/navigation-tree";
import type { NavNode } from "../../shared/types";
import { ACTION_EFFECTS, isActionEffectId } from "./action-registry";

function flatten(nodes: readonly NavNode[]): NavNode[] {
  const out: NavNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.kind === "prefix") out.push(...node.children);
  }
  return out;
}

describe("action registry", () => {
  it("covers every action node in the navigation tree", () => {
    const treeActions = flatten(NAVIGATION_TREE)
      .filter((node) => node.kind === "action")
      .map((node) => node.id)
      .sort();

    expect(Object.keys(ACTION_EFFECTS).sort()).toEqual(treeActions);
  });

  it("recognizes only typed action effect ids", () => {
    expect(isActionEffectId("reload-tab")).toBe(true);
    expect(isActionEffectId("domains")).toBe(false);
    expect(isActionEffectId("missing-action")).toBe(false);
  });
});
