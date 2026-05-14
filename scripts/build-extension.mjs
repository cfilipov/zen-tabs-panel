import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const variants = new Map([
  ["vanilla", "src-vanilla"],
  ["svelte", "src-svelte"],
]);

const variantArg = process.argv.find((arg) => arg.startsWith("--variant="));
const variant = variantArg ? variantArg.slice("--variant=".length) : "vanilla";
const sourceDirName = variants.get(variant);

if (!sourceDirName) {
  console.error(`Unknown variant "${variant}". Expected one of: ${Array.from(variants.keys()).join(", ")}`);
  process.exit(1);
}

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

const sveltePopupLegacyEntries = [
  "popup/popup.css",
  "popup/state.js",
  "popup/render.js",
  "popup/keyboard.js",
  "popup/popup.js",
  "popup/views",
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
    filter: (src) => path.basename(src) !== ".DS_Store",
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

const entriesToCopy = variant === "svelte"
  ? extensionEntries.filter((entry) => entry !== "popup")
  : extensionEntries;

for (const entry of entriesToCopy) {
  await copyEntry(entry);
}

if (variant === "svelte") {
  for (const entry of sveltePopupLegacyEntries) {
    await copyEntry(entry);
  }
  await run("node", ["scripts/generate-keybindings.mjs"]);
  await run("npx", ["vite", "build"]);
}

const copied = (await readdir(distRoot)).sort();
console.log(`Built ${variant} extension from ${sourceDirName}/ into dist/`);
console.log(copied.join("\n"));
