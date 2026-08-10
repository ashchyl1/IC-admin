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
      // `server-only` is a build-time marker with no runtime and no resolution
      // outside Next's compiler, so importing it makes a module untestable.
      // The real guarantee still comes from `next build`. See the stub.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
