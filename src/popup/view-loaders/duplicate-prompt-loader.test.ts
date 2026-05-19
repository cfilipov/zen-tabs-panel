import { describe, expect, it } from "vitest";
import { loadDuplicatePromptView } from "./duplicate-prompt-loader";

describe("duplicate prompt loader", () => {
  it("reads the duplicate URL and existing tab dom id from URL params", () => {
    const params = new URLSearchParams({
      url: "https://example.test/path",
      domId: "tab-1",
    });

    expect(loadDuplicatePromptView(params)).toEqual({
      url: "https://example.test/path",
      domId: "tab-1",
      selectedIndex: -1,
    });
  });

  it("reads warm-rearm params from a plain object", () => {
    expect(loadDuplicatePromptView({
      url: "https://example.test/warm",
      domId: "tab-2",
    })).toEqual({
      url: "https://example.test/warm",
      domId: "tab-2",
      selectedIndex: -1,
    });
  });

  it("defaults missing values to the empty prompt state", () => {
    expect(loadDuplicatePromptView(new URLSearchParams())).toEqual({
      url: "",
      domId: null,
      selectedIndex: -1,
    });
  });
});
