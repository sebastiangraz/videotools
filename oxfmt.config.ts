import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 80,
  ignorePatterns: [
    "api/_bin/**",
    "scripts/smoke-assets/**",
    "package-lock.json",
    "bun.lock",
  ],
});
