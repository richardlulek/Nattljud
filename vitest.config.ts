import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // DSP-renderingstesterna är tunga; standardens 5 s räcker inte på långsamma maskiner.
    testTimeout: 30000,
  },
});
