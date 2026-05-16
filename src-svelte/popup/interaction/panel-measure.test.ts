import { describe, expect, it } from "vitest";
import { naturalPanelHeight } from "./panel-measure";

describe("panel measurement", () => {
  it("uses list padding when there are no rendered rows", () => {
    expect(naturalPanelHeight({})).toBe(8);
  });

  it("adds list content height, header, and page indicator when visible", () => {
    expect(naturalPanelHeight({
      listFirstTop: 100,
      listLastBottom: 260,
      headerVisible: true,
      headerHeight: 42,
      indicatorVisible: true,
      indicatorHeight: 36,
    })).toBe(246);
  });

  it("ignores hidden header/indicator and clamps inverted list bounds", () => {
    expect(naturalPanelHeight({
      listFirstTop: 260,
      listLastBottom: 100,
      headerVisible: false,
      headerHeight: 42,
      indicatorVisible: false,
      indicatorHeight: 36,
    })).toBe(8);
  });
});
