import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type DomainCloseScope = {
  selectTabsForDomainClose: (
    tabs: unknown[],
    options: {
      domain: string;
      workspaceId?: string;
      includePinned?: boolean;
      domainOf: (tab: unknown) => string;
    },
  ) => { tabs: unknown[]; skippedPinned: number; skippedEssential: number };
};

type FakeTab = {
  url: string;
  pinned?: boolean;
  workspaceId?: string;
  essential?: boolean;
};

function loadDomainCloseScope(): DomainCloseScope {
  const filename = path.resolve(process.cwd(), "src/experiment/domain-close.js");
  const code = fs.readFileSync(filename, "utf8");
  const context: Record<string, unknown> = { console };
  vm.runInNewContext(code, context, { filename });
  return context as DomainCloseScope;
}

function tab(url: string, options: Omit<FakeTab, "url"> = {}): FakeTab {
  return {
    url,
    workspaceId: "main",
    hasAttribute(name: string) {
      return name === "zen-essential" ? !!this.essential : false;
    },
    getAttribute(name: string) {
      return name === "zen-workspace-id" ? this.workspaceId || null : null;
    },
    ...options,
  } as FakeTab;
}

function select(tabs: FakeTab[], options: { domain?: string; workspaceId?: string; includePinned?: boolean } = {}) {
  return loadDomainCloseScope().selectTabsForDomainClose(tabs, {
    domain: options.domain || "example.com",
    workspaceId: options.workspaceId,
    includePinned: options.includePinned,
    domainOf: (candidate) => (candidate as FakeTab).url,
  });
}

describe("domain close selection", () => {
  it("skips pinned tabs by default and always skips essentials", () => {
    const open = tab("example.com");
    const pinned = tab("example.com", { pinned: true });
    const essential = tab("example.com", { essential: true });

    const result = select([open, pinned, essential, tab("other.com")]);

    expect(result.tabs).toEqual([open]);
    expect(result.skippedPinned).toBe(1);
    expect(result.skippedEssential).toBe(1);
  });

  it("can include pinned tabs while still skipping essentials", () => {
    const open = tab("example.com");
    const pinned = tab("example.com", { pinned: true });
    const essential = tab("example.com", { essential: true });

    const result = select([open, pinned, essential], { includePinned: true });

    expect(result.tabs).toEqual([open, pinned]);
    expect(result.skippedPinned).toBe(0);
    expect(result.skippedEssential).toBe(1);
  });

  it("respects the active workspace filter", () => {
    const main = tab("example.com", { workspaceId: "main" });
    const research = tab("example.com", { workspaceId: "research" });

    expect(select([main, research], { workspaceId: "main" }).tabs).toEqual([main]);
    expect(select([main, research], { workspaceId: "all" }).tabs).toEqual([main, research]);
  });
});
