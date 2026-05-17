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

describe("popup architecture boundary", () => {
  it("does not call the experiment API directly", () => {
    const forbidden = [
      /\bbrowser\s*\.\s*zenWorkspaces\b/,
      /\bchrome\s*\.\s*zenWorkspaces\b/,
      /\bbrowser\s*\[\s*["']zenWorkspaces["']\s*\]/,
      /\bchrome\s*\[\s*["']zenWorkspaces["']\s*\]/,
    ];

    const offenders = collectSourceFiles(popupRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${relative(popupRoot, path)} matches ${pattern}`);
    });

    expect(offenders).toEqual([]);
  });
});
