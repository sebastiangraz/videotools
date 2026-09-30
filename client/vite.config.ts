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
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          setupFiles: ["src/test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
      // The api's and shared/'s pure helpers.
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["../api/_tests/**/*.test.ts", "../shared/**/*.test.ts"],
        },
      },
    ],
  },
});
