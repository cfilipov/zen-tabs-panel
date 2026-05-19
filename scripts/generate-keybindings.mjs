import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourcePath = path.join(repoRoot, "src/shared/navigation-tree.ts");
const outputPath = path.join(repoRoot, "dist/shared/keybindings.js");

const source = await readFile(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
  fileName: sourcePath,
});

const module = { exports: {} };
vm.runInNewContext(transpiled.outputText, {
  exports: module.exports,
  module,
}, {
  filename: sourcePath,
});

const {
  NAVIGATION_TREE,
  WORKSPACE_DIGIT_CHORDS,
} = module.exports;

if (!Array.isArray(NAVIGATION_TREE) || !Array.isArray(WORKSPACE_DIGIT_CHORDS)) {
  throw new Error("navigation-tree.ts did not export the expected arrays");
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `"use strict";

// Generated from src/shared/navigation-tree.ts. Do not edit by hand.

this.ZEN_KEYBINDINGS = ${JSON.stringify(NAVIGATION_TREE, null, 2)};

this.ZEN_WORKSPACE_DIGIT_CHORDS = ${JSON.stringify(WORKSPACE_DIGIT_CHORDS)};

this.zenDisplayKey = function (chord) {
  if (chord == null || chord === "") return "";
  return String(chord).replace(/^Shift\\+/, "⇧");
};
`);
