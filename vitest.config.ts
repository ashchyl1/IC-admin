import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Supplied by Next at build time; harmless and unresolvable under vitest.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
