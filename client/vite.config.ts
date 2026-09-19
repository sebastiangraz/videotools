/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Set by Vercel at build time; pins the version label to the commit this
    // deployment was built from instead of the branch tip
    __GIT_SHA__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ""),
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Blob upload mock, jest-dom matchers and the jsdom stubs every test
    // file needs
    setupFiles: ["src/test/setup.ts"],
    // The api's pure helpers are tested from here too, rather than giving
    // the functions a test setup of their own.
    include: [
      "src/**/*.test.{ts,tsx}",
      "../api/**/*.test.ts",
      "../shared/**/*.test.ts",
    ],
  },
});
