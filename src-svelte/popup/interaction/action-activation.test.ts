import { describe, expect, it } from "vitest";
import type { ActionMenuItem } from "../views/actions-model";
import { resolveActionItemActivation } from "./action-activation";

function item(overrides: Partial<ActionMenuItem>): ActionMenuItem {
  return {
    id: "reload-tab",
    kind: "action",
    label: "Reload",
    hotkey: "R",
    badge: "R",
    isView: false,
    page: 1,
    ...overrides,
  };
}

describe("action item activation", () => {
  it("ignores disabled items before interpreting their kind", () => {
    expect(resolveActionItemActivation(item({ disabled: true }))).toEqual({ kind: "none" });
    expect(resolveActionItemActivation(item({
      kind: "workspace-switch",
      workspaceId: "ws-1",
      disabled: true,
    }))).toEqual({ kind: "none" });
  });

  it("maps terminal actions, views, prefixes, and workspace switches", () => {
    expect(resolveActionItemActivation(item({ kind: "action", id: "reload-tab" })))
      .toEqual({ kind: "fire-action", actionId: "reload-tab" });

    expect(resolveActionItemActivation(item({ kind: "open-view", view: "domains", isView: true })))
      .toEqual({ kind: "open-view", view: "domains" });

    expect(resolveActionItemActivation(item({ kind: "prefix", view: "reorder-tabs", isView: true })))
      .toEqual({ kind: "open-view", view: "reorder-tabs" });

    expect(resolveActionItemActivation(item({ kind: "workspace-switch", workspaceId: "ws-1" })))
      .toEqual({ kind: "switch-workspace", workspaceId: "ws-1" });
  });

  it("returns none for incomplete workspace or view items", () => {
    expect(resolveActionItemActivation(item({ kind: "workspace-switch" }))).toEqual({ kind: "none" });
    expect(resolveActionItemActivation(item({ kind: "open-view" }))).toEqual({ kind: "none" });
  });

  it("returns none for action items missing from the typed action registry", () => {
    expect(resolveActionItemActivation(item({ id: "not-implemented" }))).toEqual({ kind: "none" });
  });
});
