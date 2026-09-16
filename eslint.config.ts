import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import globals from "globals";

export default defineConfig([
  globalIgnores(["**/dist/", ".vercel/", "api/_bin/", "**/*.d.ts"]),

  // Shared JS + TS baseline for every file in the repo
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      // Underscore-prefixed names are the conventional "intentionally unused"
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Vite + React client (browser)
  {
    files: ["client/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite()],
    languageOptions: { globals: globals.browser },
  },

  // Vitest tests (`globals: true` in client/vite.config.ts)
  {
    files: ["client/**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.vitest } },
  },

  // Node-side tooling config files
  {
    files: ["client/vite.config.ts", "client/postcss.config.js", "eslint.config.ts"],
    languageOptions: { globals: globals.node },
  },

  // Vercel functions. They run as CommonJS: api/_lib/*.js is plain CJS and the
  // .ts handlers pull in CJS-only packages via require().
  {
    files: ["api/**/*.{js,ts}"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["api/**/*.js"],
    languageOptions: { sourceType: "commonjs" },
  },
]);
