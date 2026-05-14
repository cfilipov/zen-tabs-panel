import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
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

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

for (const entry of extensionEntries) {
  await copyEntry(entry);
}

const copied = (await readdir(distRoot)).sort();
console.log(`Built ${variant} extension from ${sourceDirName}/ into dist/`);
console.log(copied.join("\n"));
