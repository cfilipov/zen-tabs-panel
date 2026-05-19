import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sourceDirName = "src";
const sourceRoot = path.join(repoRoot, sourceDirName);
const distRoot = path.join(repoRoot, "dist");

const extensionEntries = [
  "manifest.json",
  "background.js",
  "experiment",
  "popup",
  "shared",
  "lib",
  "options",
  "welcome",
  "icons",
  "LICENSE",
];

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyEntry(entry) {
  const from = path.join(sourceRoot, entry);
  if (!(await exists(from))) return;
  await cp(from, path.join(distRoot, entry), {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === ".DS_Store") return false;
      if (base.endsWith(".test.ts") || base.endsWith(".test.js")) return false;
      if (base.endsWith(".ts")) return false;
      return true;
    },
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

const entriesToCopy = extensionEntries.filter((entry) => entry !== "popup");

for (const entry of entriesToCopy) {
  await copyEntry(entry);
}

await run("node", ["scripts/generate-keybindings.mjs"]);
await run("npx", ["vite", "build"]);

const copied = (await readdir(distRoot)).sort();
console.log(`Built extension from ${sourceDirName}/ into dist/`);
console.log(copied.join("\n"));
