import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourcePath = path.join(repoRoot, "src/shared/navigation-tree.ts");
const actionSectionsPath = path.join(repoRoot, "src/shared/action-sections.ts");
const outputPath = path.join(repoRoot, "dist/shared/keybindings.js");

async function evaluateTsModule(modulePath) {
  const source = await readFile(modulePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: modulePath,
  });
  const module = { exports: {} };
  vm.runInNewContext(transpiled.outputText, {
    exports: module.exports,
    module,
  }, {
    filename: modulePath,
  });
  return module.exports;
}

const {
  NAVIGATION_TREE,
  WORKSPACE_DIGIT_CHORDS,
} = await evaluateTsModule(sourcePath);
const {
  ACTION_SECTIONS,
} = await evaluateTsModule(actionSectionsPath);

if (!Array.isArray(NAVIGATION_TREE) || !Array.isArray(WORKSPACE_DIGIT_CHORDS) || !Array.isArray(ACTION_SECTIONS)) {
  throw new Error("shared navigation/action modules did not export the expected arrays");
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `"use strict";

// Generated from src/shared/navigation-tree.ts and src/shared/action-sections.ts.
// Do not edit by hand.

this.ZEN_KEYBINDINGS = ${JSON.stringify(NAVIGATION_TREE, null, 2)};

this.ZEN_ACTION_SECTIONS = ${JSON.stringify(ACTION_SECTIONS, null, 2)};

this.ZEN_WORKSPACE_DIGIT_CHORDS = ${JSON.stringify(WORKSPACE_DIGIT_CHORDS)};

this.zenDisplayKey = function (chord) {
  if (chord == null || chord === "") return "";
  return String(chord).replace(/^Shift\\+/, "⇧");
};
`);
