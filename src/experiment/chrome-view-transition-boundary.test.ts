import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(experimentRoot, "api.js"), "utf8");

function functionBody(name: string) {
  let start = apiSource.indexOf(`function ${name}`);
  if (start < 0) start = apiSource.indexOf(`${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const signatureEnd = apiSource.indexOf(")", start);
  const open = apiSource.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = open; index < apiSource.length; index++) {
    const char = apiSource[index];
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth === 0) return apiSource.slice(open + 1, index);
  }
  throw new Error(`Could not parse function body for ${name}`);
}

describe("chrome view transition boundary", () => {
  it("keeps hidden bridge row handling out of view-specific bespoke branches", () => {
    const body = functionBody("tryHandleChromeOwnedBridgeKey");

    expect(body).not.toMatch(/activeView\s*===\s*["']domains["']/);
    expect(body).not.toMatch(/switchHiddenBridgeView\s*\(/);
    expect(body).toMatch(/applyBridgeActivationResult\s*\(/);
  });

  it("keeps domain drill params on the open-view activation path", () => {
    const activation = functionBody("activateChromeOwnedRowIntent");
    const coordinator = functionBody("createChromeViewTransitionCoordinator");

    expect(activation).toMatch(/const nextParams = \{ domain: row\.domain \}/);
    expect(activation).toMatch(/activationOpenView\("domain-tabs", nextParams\)/);
    expect(coordinator).toMatch(/switchHiddenBridgeView\(\s*result\.view,\s*result\.params \|\| \{\}/);
  });

  it("uses current list params when activating chrome-owned tab rows", () => {
    const activation = functionBody("activateChromeOwnedRowIntent");
    const apiMethod = functionBody("activateCurrentViewRow");

    expect(activation).toMatch(/const viewParams = params \|\| \{\}/);
    expect(activation).not.toMatch(/view === "domain-tabs" \? params : \{\}/);
    expect(apiMethod).toMatch(/paramsJson/);
    expect(apiMethod).toMatch(/JSON\.parse\(paramsJson\)/);
  });

  it("keeps WarmRearm sends behind the coordinator helper", () => {
    const sends = [...apiSource.matchAll(/sendAsyncMessage\("ZenChord:WarmRearm:/g)];
    const helper = functionBody("sendWarmRearmMessage");
    const settings = functionBody("setSkipOverlayAnimations");
    const coordinator = functionBody("createChromeViewTransitionCoordinator");

    expect(sends).toHaveLength(1);
    expect(helper).toMatch(/sendAsyncMessage\("ZenChord:WarmRearm:/);
    expect(settings).not.toMatch(/WarmRearm/);
    expect(coordinator).toMatch(/sendWarmRearmForTransition\s*\(/);
    expect(coordinator).not.toMatch(/sendWarmRearm\s*:\s*sendWarmRearmMessage/);
    expect(apiSource).not.toMatch(/chromeViewTransitions\.sendWarmRearm/);
  });

  it("keeps resetViewState inside the chrome transition coordinator", () => {
    const coordinator = functionBody("createChromeViewTransitionCoordinator");
    const sourceWithoutCoordinator = apiSource.replace(coordinator, "");

    expect(coordinator).toMatch(/overlayController\.resetViewState/);
    expect(sourceWithoutCoordinator).not.toMatch(/overlayController\.resetViewState/);
  });

  it("keeps resize messages from rewriting chrome-owned view params", () => {
    const body = functionBody("resizePanelToView");
    const coordinator = functionBody("createChromeViewTransitionCoordinator");

    expect(body).toMatch(/reapplyCurrentViewForResize\s*\(view\)/);
    expect(body).not.toMatch(/setCurrentView\s*\(\s*view\s*\|\|\s*["']actions["']\s*,/);
    expect(coordinator).toMatch(/setCurrentViewName\s*\(nextView\)/);
  });

  it("rejects params mismatches before WarmRearm payloads leave chrome", () => {
    const helper = functionBody("sendWarmRearmMessage");

    expect(apiSource).toMatch(/function traceChromeViewInvariant/);
    expect(helper).toMatch(/if \(!traceChromeViewInvariant\("sendWarmRearm"/);
    expect(helper).toMatch(/return false/);
  });
});
