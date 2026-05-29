import { describe, expect, it } from "vitest";
import { filterCommands } from "./command-palette-filter";
import type { ActionMenuItem } from "../views/actions-model";

function item(id: string, label: string, searchText?: string): ActionMenuItem {
  return {
    id,
    kind: "action",
    label,
    searchText,
    hotkey: "",
    badge: "",
    isView: false,
    page: 1,
  };
}

describe("command palette filter", () => {
  it("returns all commands for an empty query", () => {
    const commands = [item("previous", "Previous"), item("split", "Split: Vertical")];

    expect(filterCommands(commands, "").map((command) => command.id)).toEqual(["previous", "split"]);
    expect(filterCommands(commands, "   ").map((command) => command.id)).toEqual(["previous", "split"]);
  });

  it("matches case-insensitively by subsequence", () => {
    const commands = [
      item("split-vertical", "Split: Vertical"),
      item("domain-alpha", "Reorder tabs: Domain (A-Z)"),
    ];

    expect(filterCommands(commands, "SV").map((command) => command.id)).toEqual(["split-vertical"]);
    expect(filterCommands(commands, "daz").map((command) => command.id)).toEqual(["domain-alpha"]);
  });

  it("matches prefix children through searchText", () => {
    const commands = [
      item("sort-tabs-domain-alpha", "Reorder tabs: Domain (A-Z)", "Reorder tabs Domain (A-Z) sort-tabs-domain-alpha"),
      item("domains", "Domains"),
    ];

    expect(filterCommands(commands, "sort").map((command) => command.id)).toEqual(["sort-tabs-domain-alpha"]);
  });

  it("ranks prefix and contiguous matches before looser subsequence matches", () => {
    const commands = [
      item("loose", "Recently closed", "Recently closed"),
      item("substring", "Tab history", "Open tab history"),
      item("prefix", "Tabs by age", "Tabs by age"),
      item("also-prefix", "Tab info", "Tab info"),
    ];

    expect(filterCommands(commands, "tab").map((command) => command.id)).toEqual([
      "prefix",
      "also-prefix",
      "substring",
    ]);
  });
});
