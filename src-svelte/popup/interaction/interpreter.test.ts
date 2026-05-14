import { describe, expect, it } from "vitest";
import type { NavNode, PrefixNode } from "../../shared/types";
import { interpretTreeInput, interpretVisibleInput } from "./interpreter";

const fixtureTree = [
  { id: "recent", kind: "open-view", chord: "R", view: "last-visited", label: "Recent" },
  {
    id: "reorder",
    kind: "prefix",
    chord: "O",
    view: "reorder-tabs",
    label: "Reorder",
    children: [
      { id: "sort-recent", kind: "action", chord: "R", label: "Recent first" },
      { id: "sort-domain", kind: "action", chord: "D", label: "Domain" },
    ],
  },
] satisfies NavNode[];

const reorderNode = fixtureTree[1] as PrefixNode;

describe("interaction interpreter", () => {
  it("maps fast chord input to the same node metadata as visible key input", () => {
    const fast = interpretTreeInput({ kind: "chord", chord: "R" }, { view: "actions" }, fixtureTree);
    const visible = interpretVisibleInput({ kind: "key", key: "r" }, { view: "actions" }, fixtureTree);
    const mouse = interpretVisibleInput({ kind: "mouse", targetId: "recent" }, { view: "actions" }, fixtureTree);

    expect(fast).toEqual({ kind: "open-view", view: "last-visited", source: "tree" });
    expect(visible).toEqual({ kind: "open-view", view: "last-visited", source: "view" });
    expect(mouse).toEqual({ kind: "open-view", view: "last-visited", source: "mouse" });
  });

  it("uses the same prefix child lookup for fast, visible, bridge, and mouse activation", () => {
    const context = { view: "reorder-tabs" as const, treePath: ["reorder"] };
    const fast = interpretTreeInput({ kind: "chord", chord: "D" }, context, fixtureTree);
    const bridge = interpretTreeInput({ kind: "key", key: "d" }, context, fixtureTree);
    const visible = interpretVisibleInput({ kind: "key", key: "d" }, context, reorderNode.children);
    const mouse = interpretVisibleInput({ kind: "mouse", targetId: "sort-domain" }, context, reorderNode.children);

    expect(fast).toEqual({ kind: "action", actionId: "sort-domain", source: "tree" });
    expect(bridge).toEqual({ kind: "action", actionId: "sort-domain", source: "tree" });
    expect(visible).toEqual({ kind: "action", actionId: "sort-domain", source: "view" });
    expect(mouse).toEqual({ kind: "action", actionId: "sort-domain", source: "mouse" });
  });

  it("keeps structural navigation separate from chord tree actions", () => {
    expect(interpretVisibleInput({ kind: "key", key: "ArrowDown" }, { view: "actions" }, fixtureTree))
      .toEqual({ kind: "move-selection", delta: 1 });
    expect(interpretVisibleInput({ kind: "key", key: "Backspace" }, { view: "last-visited" }, fixtureTree))
      .toEqual({ kind: "back" });
  });
});
