import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
    environment: "node",
  },
});
