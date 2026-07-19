import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mail-ai/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      "@mail-ai/classifier": fileURLToPath(new URL("../../packages/classifier/src/index.ts", import.meta.url)),
    },
  },
});
