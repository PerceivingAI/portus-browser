import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    css: true,
    environment: "jsdom",
    globals: true,
    include: ["tests/gui/**/*.test.tsx"],
    setupFiles: ["./tests/gui/setup.ts"]
  }
});

