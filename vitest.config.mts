import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/**/*.test.{js,mjs,ts,mts}",
      "conformance/**/*.test.{js,mjs,ts,mts}",
    ],
  },
});
