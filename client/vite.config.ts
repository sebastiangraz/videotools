import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    // Set by Vercel at build time: pins the version label to the built commit
    // rather than the branch tip.
    __GIT_SHA__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ""),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    // The api's pure helpers are tested from here too.
    include: [
      "src/**/*.test.{ts,tsx}",
      "../api/**/*.test.ts",
      "../shared/**/*.test.ts",
    ],
  },
});
