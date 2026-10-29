import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The engine's threads share memory, which needs cross-origin isolation. Set
// ahead of everything, as server.headers skips 304s and WebKit then refuses
// the revalidated worker scripts.
const isolate: Connect.NextHandleFunction = (_, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
};
const isolated: Plugin = {
  name: "isolated",
  configureServer: (server) => void server.middlewares.use(isolate),
  configurePreviewServer: (server) => void server.middlewares.use(isolate),
};

const engine = (file: string) => fileURLToPath(new URL(`src/engine/${file}`, import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react(), isolated],
  // Aliases live in tsconfig.json paths; these two let the server's tools run
  // in the engine worker, and stay out of tests, which run the tools on Node.
  resolve: {
    tsconfigPaths: true,
    alias:
      mode === "test"
        ? undefined
        : { "node:fs/promises": engine("fs.ts"), "node:path": engine("path.ts") },
  },
  worker: { format: "es" },
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
}));
