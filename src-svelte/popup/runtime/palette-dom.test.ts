import { describe, expect, it } from "vitest";
import { measurePaletteNaturalHeight, scrollPaletteListIndexIntoView, snapshotKeyEvent } from "./palette-dom";

function setRect(element: Element, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 0,
    height: rect.height ?? 0,
    top: rect.top ?? 0,
    bottom: rect.bottom ?? 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("palette DOM runtime helpers", () => {
  it("normalizes keyboard events for the bridge dispatcher", () => {
    const event = new KeyboardEvent("keydown", {
      key: "R",
      code: "KeyR",
      shiftKey: true,
      altKey: true,
      ctrlKey: true,
      metaKey: true,
    });

    expect(snapshotKeyEvent(event)).toEqual({
      key: "R",
      code: "KeyR",
      shiftKey: true,
      altKey: true,
      ctrlKey: true,
      metaKey: true,
    });
  });

  it("measures natural panel height from header, list, and page indicator geometry", () => {
    document.body.innerHTML = `
      <div id="header"><span>Title</span></div>
      <div id="list"><div id="first"></div><div id="last"></div></div>
      <div id="page-indicator"></div>
    `;
    setRect(document.getElementById("header")!, { top: 0, bottom: 30, height: 30 });
    setRect(document.getElementById("first")!, { top: 40, bottom: 80 });
    setRect(document.getElementById("last")!, { top: 80, bottom: 120 });
    setRect(document.getElementById("page-indicator")!, { top: 120, bottom: 140, height: 20 });

    expect(measurePaletteNaturalHeight(document)).toBe(138);
  });

  it("scrolls the palette list to keep an absolute index visible", () => {
    document.body.innerHTML = `<div id="list"></div>`;
    const list = document.getElementById("list")!;
    Object.defineProperty(list, "clientHeight", { value: 120, configurable: true });
    list.scrollTop = 0;

    scrollPaletteListIndexIntoView(10, document, (callback) => {
      callback(0);
      return 1;
    });

    expect(list.scrollTop).toBeGreaterThan(0);
  });
});
