import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// The commit Vercel builds, else the checked-out branch, so local runs link
// files that exist on GitHub once pushed (a local commit may not be).
const gitRef = (): string => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return branch === "HEAD" ? "" : branch;
  } catch {
    return "";
  }
};

export default defineConfig({
  plugins: [react()],
  // Aliases live in tsconfig.json paths.
  resolve: { tsconfigPaths: true },
  define: {
    __GIT_REF__: JSON.stringify(gitRef()),
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
