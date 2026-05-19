import { describe, expect, it } from "vitest";
import {
  directionalListItemId,
  scrollPaletteListIndexIntoView,
  scrollSelectedItemIntoView,
  snapshotKeyEvent,
} from "./palette-dom";

function setRect(element: Element, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    top: rect.top ?? 0,
    bottom: rect.bottom ?? 0,
    left: rect.left ?? 0,
    right: rect.right ?? 0,
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

  it("scrolls the nearest scroll container to keep the selected row visible", () => {
    document.body.innerHTML = `
      <div id="list">
        <div class="section-scroll">
          <button class="list-item selected"></button>
        </div>
      </div>
    `;
    const list = document.getElementById("list")!;
    const scroller = document.querySelector<HTMLElement>(".section-scroll")!;
    const selected = document.querySelector<HTMLElement>(".selected")!;
    Object.defineProperty(list, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(list, "scrollHeight", { value: 300, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(scroller, "scrollHeight", { value: 300, configurable: true });
    setRect(list, { top: 0, bottom: 300, height: 300 });
    setRect(scroller, { top: 0, bottom: 100, height: 100 });
    setRect(selected, { top: 140, bottom: 188, height: 48 });

    scrollSelectedItemIntoView(document, (callback) => {
      callback(0);
      return 1;
    });

    expect(scroller.scrollTop).toBe(88);
  });

  it("finds the nearest selectable item in a horizontal direction", () => {
    document.body.innerHTML = `
      <div id="list">
        <div class="actions-page" data-page="1">
          <button class="list-item selected" data-id="left"></button>
          <button class="list-item disabled" data-id="disabled" disabled></button>
          <button class="list-item" data-id="right"></button>
          <button class="list-item" data-id="far"></button>
        </div>
      </div>
    `;
    const [left, disabled, right, far] = Array.from(document.querySelectorAll(".list-item"));
    setRect(left, { left: 0, right: 100, top: 0, bottom: 40, width: 100, height: 40 });
    setRect(disabled, { left: 120, right: 220, top: 0, bottom: 40, width: 100, height: 40 });
    setRect(right, { left: 120, right: 220, top: 60, bottom: 100, width: 100, height: 40 });
    setRect(far, { left: 260, right: 360, top: 0, bottom: 40, width: 100, height: 40 });

    expect(directionalListItemId(1, { currentPage: 1, doc: document })).toBe("right");
  });
});
