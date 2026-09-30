import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
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
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["../api/_tests/**/*.test.ts"],
        },
      },
    ],
  },
});
