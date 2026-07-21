import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and serves the built assets from dist/.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Don't watch the Rust build tree — churning target/ artifacts trigger EBUSY on Windows
    // and kill the vite dev server (and with it `tauri dev`).
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    outDir: "dist",
    target: "es2021",
    sourcemap: true,
  },
});
