import { defineConfig } from "vitest/config";

/**
 * Vitest runs the runner-agnostic framework contract spec with jest-compatible
 * globals enabled, so the shared spec can use `describe`/`it`/`expect` without
 * importing a runner. The rest of the package suite stays on jest.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/framework-contract.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    reporters: ["default"],
  },
});
