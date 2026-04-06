import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // VITE_API_URL is injected at build time via the VITE_ prefix convention.
  // Access in code via: import.meta.env.VITE_API_URL
  // No extra config needed — Vite exposes all VITE_* env vars automatically.
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
  },
});
