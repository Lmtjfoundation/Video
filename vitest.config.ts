import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      // `server-only` throws outside Next's server bundle; tests run in plain Node.
      "server-only": r("./tests/server-only-stub.ts"),
    },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
