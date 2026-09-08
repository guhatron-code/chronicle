import { defineConfig } from "vitest/config";
import path from "node:path";

// Pure-module tests only (scheduler & co). Component tests are out of scope —
// the app is verified in the running Tauri window, not jsdom.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
