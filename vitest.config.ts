import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live beside the code they cover. Nothing outside src/ is a test,
    // and the packed plugin folder can hold a node_modules tree during a
    // release smoke check, so keep the scan tightly scoped.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
