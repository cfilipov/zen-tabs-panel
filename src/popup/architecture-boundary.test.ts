import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const popupRoot = dirname(fileURLToPath(import.meta.url));
const sourceExtensions = new Set([".ts", ".svelte", ".js"]);
const ignoredSuffixes = [".test.ts", ".test.js", ".test.svelte.ts"];

function extensionOf(path: string) {
  const match = path.match(/(\.svelte|\.ts|\.js)$/);
  return match?.[1] ?? "";
}

function collectSourceFiles(dir: string, files: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectSourceFiles(path, files);
      continue;
    }
    if (!sourceExtensions.has(extensionOf(path))) continue;
    if (ignoredSuffixes.some((suffix) => path.endsWith(suffix))) continue;
    files.push(path);
  }
  return files;
}

function collectSourceFilesFrom(relativeDirs: string[]) {
  return relativeDirs.flatMap((dir) => collectSourceFiles(join(popupRoot, dir)));
}

function matchingOffenders(files: string[], forbidden: RegExp[]) {
  return files.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return forbidden
      .filter((pattern) => pattern.test(source))
      .map((pattern) => `${relative(popupRoot, path)} matches ${pattern}`);
  });
}

describe("popup architecture boundary", () => {
  it("does not call the experiment API directly", () => {
    const forbidden = [
      /\bbrowser\s*\.\s*zenWorkspaces\b/,
      /\bchrome\s*\.\s*zenWorkspaces\b/,
      /\bbrowser\s*\[\s*["']zenWorkspaces["']\s*\]/,
      /\bchrome\s*\[\s*["']zenWorkspaces["']\s*\]/,
    ];

    const offenders = matchingOffenders(collectSourceFiles(popupRoot), forbidden);

    expect(offenders).toEqual([]);
  });

  it("keeps WebExtension tab APIs out of the popup", () => {
    const forbidden = [
      /\bbrowser\s*\.\s*tabs\b/,
      /\bchrome\s*\.\s*tabs\b/,
      /\bbrowser\s*\[\s*["']tabs["']\s*\]/,
      /\bchrome\s*\[\s*["']tabs["']\s*\]/,
    ];

    const offenders = matchingOffenders(collectSourceFiles(popupRoot), forbidden);

    expect(offenders).toEqual([]);
  });

  it("keeps IPC in runtime shells, not leaf views or components", () => {
    const forbidden = [
      /\bbrowser\s*\.\s*runtime\b/,
      /\bchrome\s*\.\s*runtime\b/,
      /\bsendMessage\s*\(/,
      /\bfireMessage\s*\(/,
    ];

    const offenders = matchingOffenders(collectSourceFilesFrom(["views", "components"]), forbidden);

    expect(offenders).toEqual([]);
  });

  it("keeps low-level IPC out of the palette component", () => {
    const source = readFileSync(join(popupRoot, "NativePalette.svelte"), "utf8");

    expect(source).not.toMatch(/\.\/runtime\/ipc/);
    expect(source).not.toMatch(/\bsendMessage\s*\(/);
    expect(source).not.toMatch(/\bfireMessage\s*\(/);
  });

  it("keeps leaf view imports behind ViewHost", () => {
    const source = readFileSync(join(popupRoot, "NativePalette.svelte"), "utf8");
    const offenders = [...source.matchAll(/from\s+["']\.\/views\/(?!ViewHost\.svelte["'])[^"']+\.svelte["']/g)]
      .map((match) => match[0]);

    expect(offenders).toEqual([]);
  });

  it("keeps palette state writes behind named store mutators", () => {
    const source = readFileSync(join(popupRoot, "NativePalette.svelte"), "utf8");
    const offenders = [...source.matchAll(/\bpalette\.[A-Za-z0-9_]+\s*=(?!=)/g)]
      .map((match) => match[0]);

    expect(offenders).toEqual([]);
  });

  it("keeps negative current-view guards out of the palette component", () => {
    const source = readFileSync(join(popupRoot, "NativePalette.svelte"), "utf8");

    expect(source).not.toMatch(/\bcurrentView\s*!==/);
    expect(source).not.toMatch(/\bisCurrentView\b/);
    expect(source).not.toMatch(/\bcurrentView\s*===\s*["'](?:recently-closed|parent-tabs)["']/);
  });

  it("keeps virtualized list callers keyed by stable row identity", () => {
    const offenders = collectSourceFilesFrom(["views"]).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/<VirtualList\b[\s\S]*?>/g)]
        .filter((match) => !/\bgetKey\s*=/.test(match[0]))
        .map(() => relative(popupRoot, path));
    });

    expect(offenders).toEqual([]);
  });

  it("keeps typed navigation registries present", () => {
    const navigationTree = readFileSync(join(popupRoot, "..", "shared", "navigation-tree.ts"), "utf8");
    const actionRegistry = readFileSync(join(popupRoot, "interaction", "action-registry.ts"), "utf8");
    const viewRegistry = readFileSync(join(popupRoot, "view-loaders", "view-registry.ts"), "utf8");

    expect(navigationTree).toMatch(/\bActionEffectId\b/);
    expect(actionRegistry).toMatch(/Record<ActionEffectId,/);
    expect(viewRegistry).toMatch(/\bViewLoaderId\b/);
    expect(viewRegistry).toMatch(/Exclude<NavigationViewId, PlannedNavigationView>/);
  });

  it("keeps structural key handling declarative", () => {
    const source = readFileSync(join(popupRoot, "interaction", "interpreter.ts"), "utf8");

    expect(source).toMatch(/\bstructuralKeyResolvers\b/);
    expect(source).not.toMatch(/switch\s*\(\s*input\.key\s*\)/);
  });

  it("keeps DOM access out of pure state and interaction modules", () => {
    const forbidden = [
      /\bdocument\s*\./,
      /\bwindow\s*\./,
      /\bquerySelector\b/,
      /\bgetElementById\b/,
      /\baddEventListener\b/,
      /\bremoveEventListener\b/,
      /\bHTMLElement\b/,
      /\bKeyboardEvent\b/,
    ];

    const offenders = matchingOffenders(collectSourceFilesFrom(["store", "interaction"]), forbidden);

    expect(offenders).toEqual([]);
  });

  it("keeps hard-coded chord and hotkey metadata out of leaf views or components", () => {
    const forbidden = [
      /\bchord\s*:\s*["']/,
      /\bhotkey\s*:\s*["']/,
      /\bkey\s*:\s*["'][A-Za-z0-9]/,
      /Shift\+[A-Za-z0-9]/,
    ];

    const offenders = matchingOffenders(collectSourceFilesFrom(["views", "components"]), forbidden);

    expect(offenders).toEqual([]);
  });
});
