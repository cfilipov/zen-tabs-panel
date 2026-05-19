import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [svelte({ compilerOptions: { runes: true } })],
  resolve: {
    conditions: ["browser"],
  },
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: "src/popup/popup.html",
      },
      output: {
        entryFileNames: "popup/assets/[name].js",
        chunkFileNames: "popup/assets/[name].js",
        assetFileNames: "popup/assets/[name][extname]",
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["**/*.test.ts"],
  },
});
