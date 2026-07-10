import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tauri sets TAURI_DEV_HOST when the dev server must bind a LAN address (mobile dev);
// desktop-only today, but honoring it costs nothing.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Tauri owns the terminal; don't let Vite clear it.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true, // tauri.conf.json devUrl is pinned to 1420 — fail loudly, never drift
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Vite 8 (Rolldown) minifies with Oxc by default; `minify:"esbuild"` would need esbuild installed.
  build: { outDir: "dist", target: "safari15", sourcemap: false },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
