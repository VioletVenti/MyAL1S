/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy /api to the FastAPI backend so the browser hits one origin.
// Vitest uses the `test` block below (jsdom env) for the frontend render tests.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // React 19 + testing-library can emit act() warnings for async settling;
    // they're noise here, not failures.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
