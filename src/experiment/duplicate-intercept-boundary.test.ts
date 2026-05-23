import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(experimentRoot, "api.js"), "utf8");

describe("duplicate intercept frame-script boundary", () => {
  it("generation-tags chrome-to-content duplicate intercept broadcasts", () => {
    expect(apiSource).toMatch(
      /broadcastAsyncMessage\("ZenDuplicate:SetIntercept:" \+ CHORD_GENERATION/,
    );
    expect(apiSource).not.toMatch(
      /broadcastAsyncMessage\("ZenDuplicate:SetIntercept"\s*,/,
    );
  });

  it("generation-tags content listeners for chrome-owned duplicate state", () => {
    expect(apiSource).toMatch(
      /addMessageListener\('ZenDuplicate:SetIntercept:' \+ __GEN/,
    );
    expect(apiSource).toMatch(
      /addMessageListener\('ZenDuplicate:UrlStatus:' \+ __GEN/,
    );
    expect(apiSource).not.toMatch(
      /addMessageListener\('ZenDuplicate:SetIntercept',/,
    );
  });
});
