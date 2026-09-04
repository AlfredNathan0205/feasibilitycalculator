import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default include glob also matches *.spec.ts, which collides
    // with the Playwright e2e suite in e2e/ (which uses @playwright/test's
    // own test/expect, not Vitest's — Vitest can't collect them at all).
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
  },
});
