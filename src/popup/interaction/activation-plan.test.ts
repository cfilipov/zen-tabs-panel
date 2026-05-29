import { describe, expect, it } from "vitest";
import {
  activationPlanForRenderedRow,
  activationPlanForSelection,
  activationPlanForShortcut,
} from "./activation-plan";

describe("activation plan", () => {
  it("routes action and prefix selections to local item activation", () => {
    expect(activationPlanForSelection("actions", 2))
      .toEqual({ kind: "action-selection", index: 2 });
    expect(activationPlanForSelection("command-palette", 1))
      .toEqual({ kind: "action-selection", index: 1 });
    expect(activationPlanForSelection("reorder-tabs", 1))
      .toEqual({ kind: "prefix-selection", index: 1 });
  });

  it("routes chrome-owned model views to row intents", () => {
    expect(activationPlanForSelection("last-visited", 3))
      .toEqual({ kind: "chrome-model-row", index: 3, source: "selection", switchToTarget: false });
    expect(activationPlanForShortcut("move-to-workspace", 4, true))
      .toEqual({ kind: "chrome-model-row", index: 4, source: "shortcut", switchToTarget: true });
    expect(activationPlanForRenderedRow("navigation", 5))
      .toEqual({ kind: "chrome-model-row", index: 5, source: "selection", switchToTarget: false });
  });

  it("routes duplicate prompt activation through its special resolver", () => {
    expect(activationPlanForSelection("duplicate-prompt", 0))
      .toEqual({ kind: "duplicate-prompt", index: 0, source: "selection" });
    expect(activationPlanForShortcut("duplicate-prompt", 1))
      .toEqual({ kind: "duplicate-prompt", index: 1, source: "shortcut" });
  });

  it("routes domain-close confirmation activation through its popup-owned resolver", () => {
    expect(activationPlanForSelection("domain-close-confirm", 1))
      .toEqual({ kind: "domain-close-confirm", index: 1 });
    expect(activationPlanForShortcut("domain-close-confirm", 2))
      .toEqual({ kind: "domain-close-confirm", index: 2 });
  });

  it("ignores unsupported views", () => {
    expect(activationPlanForSelection("tab-info", 0)).toEqual({ kind: "none" });
    expect(activationPlanForShortcut("actions", 0)).toEqual({ kind: "none" });
  });
});
