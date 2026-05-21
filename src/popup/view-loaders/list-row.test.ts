import { describe, expect, it } from "vitest";
import { isDomainRow, isTabRow } from "./list-row";

describe("native list row type guards", () => {
  it("identifies domain rows", () => {
    expect(isDomainRow({ kind: "domain", domain: "example.test" } as never)).toBe(true);
    expect(isTabRow({ kind: "domain", domain: "example.test" } as never)).toBe(false);
  });

  it("treats non-domain rows as tab rows", () => {
    expect(isTabRow({ kind: "tab", domId: "tab-1" } as never)).toBe(true);
    expect(isDomainRow({ kind: "tab", domId: "tab-1" } as never)).toBe(false);
  });

  it("ignores null rows", () => {
    expect(isTabRow(null)).toBe(false);
    expect(isDomainRow(null)).toBe(false);
  });
});
