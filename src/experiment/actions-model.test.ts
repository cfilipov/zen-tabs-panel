import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ACTION_SECTIONS } from "../shared/action-sections";
import { NAVIGATION_TREE, displayKey } from "../shared/navigation-tree";
import type { NavNode, PrefixChildNode } from "../shared/types";

type ActionsModelScope = {
  createZenActionsModel: (deps: Record<string, unknown>) => {
    getViewModel: (input: Record<string, unknown>) => Record<string, any>;
  };
};

function loadActionsModelScope(): ActionsModelScope {
  const filename = path.resolve(process.cwd(), "src/experiment/actions-model.js");
  const code = fs.readFileSync(filename, "utf8");
  const context: Record<string, unknown> = { console };
  vm.runInNewContext(code, context, { filename });
  return context as ActionsModelScope;
}

function createModel() {
  return loadActionsModelScope().createZenActionsModel({
    sectionDefs: ACTION_SECTIONS,
    navigationTree: NAVIGATION_TREE,
    displayKey,
  });
}

function commandModel(input: Record<string, unknown> = {}) {
  return createModel().getViewModel({
    workspaces: [],
    snapshot: {},
    extensions: [],
    recentlyClosedCount: 0,
    navHistory: null,
    selectedDomIds: [],
    ...input,
  });
}

function flattenAll(nodes: readonly NavNode[]) {
  const out: Array<NavNode | PrefixChildNode> = [];
  for (const node of nodes) {
    out.push(node);
    if (node.kind === "prefix") out.push(...node.children);
  }
  return out;
}

function commandTerminals(nodes: readonly NavNode[]) {
  return nodes.flatMap((node) => {
    if (node.kind === "prefix") return [...node.children];
    return node.kind === "action" || node.kind === "open-view" ? [node] : [];
  });
}

describe("actions model command palette items", () => {
  it("covers every terminal command and omits prefix parents", () => {
    const model = commandModel();
    const ids = model.commandPaletteItems.map((item: { id: string }) => item.id).sort();
    const terminalIds = commandTerminals(NAVIGATION_TREE).map((node) => node.id).sort();
    const prefixIds = new Set<string>(NAVIGATION_TREE
      .filter((node) => node.kind === "prefix")
      .map((node) => node.id));

    expect(ids).toEqual(terminalIds);
    expect(ids.filter((id: string) => prefixIds.has(id))).toEqual([]);
  });

  it("keeps every command-palette row id resolvable to a navigation node", () => {
    const nodeIds = new Set(flattenAll(NAVIGATION_TREE).map((node) => node.id));
    const missing = commandModel().commandPaletteItems
      .map((item: { id: string }) => item.id)
      .filter((id: string) => !nodeIds.has(id));

    expect(missing).toEqual([]);
  });

  it("qualifies prefix children and includes parent labels in search text", () => {
    const items = commandModel().commandPaletteItems;
    const domainSort = items.find((item: { id: string }) => item.id === "sort-tabs-domain-alpha");

    expect(domainSort).toMatchObject({
      label: "Reorder tabs: Domain (A-Z)",
      chordPathBadge: "⌘. O D",
      badge: "⌘. O D",
    });
    expect(domainSort.searchText).toContain("Reorder tabs");
    expect(domainSort.searchText).toContain("sort-tabs-domain-alpha");
  });

  it("shows the full leader chord for top-level commands", () => {
    const items = commandModel().commandPaletteItems;
    const previous = items.find((item: { id: string }) => item.id === "go-to-previous-tab");

    expect(previous).toMatchObject({
      label: "Previous",
      chordPathBadge: "⌘. P",
      badge: "⌘. P",
    });
  });

  it("uses the configured leader badge when provided by the background", () => {
    const items = commandModel({ commandPaletteLeaderBadge: "⌘⌥." }).commandPaletteItems;
    const domainSort = items.find((item: { id: string }) => item.id === "sort-tabs-domain-alpha");

    expect(domainSort).toMatchObject({
      chordPathBadge: "⌘⌥. O D",
      badge: "⌘⌥. O D",
    });
  });

  it("keeps unavailable commands visible but disabled", () => {
    const items = commandModel().commandPaletteItems;
    const recentlyClosed = items.find((item: { id: string }) => item.id === "recently-closed");

    expect(recentlyClosed).toMatchObject({ disabled: true });
  });

  it("labels the essentials action as remove when the current tab is already essential", () => {
    const model = commandModel({ snapshot: { currentTabIsEssential: true } });
    const actionRow = model.sections
      .flatMap((section: { items: Array<{ id: string }> }) => section.items)
      .find((item: { id: string }) => item.id === "add-to-essentials");
    const commandRow = model.commandPaletteItems
      .find((item: { id: string }) => item.id === "add-to-essentials");

    expect(actionRow).toMatchObject({ label: "Remove from essentials" });
    expect(commandRow).toMatchObject({
      label: "Remove from essentials",
      searchText: "Remove from essentials add-to-essentials",
    });
  });
});
