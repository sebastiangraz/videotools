import css from "@eslint/css";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import globals from "globals";

export default defineConfig([
  globalIgnores(["**/dist/", ".vercel/", ".smoke/", "api/_bin/", "**/*.d.ts"]),

  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
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

  {
    files: ["client/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite()],
    languageOptions: { globals: globals.browser },
  },

  // Vitest `globals: true` (client/vite.config.ts)
  {
    files: ["client/**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.vitest } },
  },

  {
    files: [
      "client/vite.config.ts",
      "eslint.config.ts",
      "scripts/**/*.mjs",
    ],
    languageOptions: { globals: globals.node },
  },

  // Type-aware rules via the root tsconfig.json.
  {
    files: ["api/**/*.{js,ts}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["**/*.css"],
    plugins: { css },
    language: "css/css",
    extends: ["css/recommended"],
    languageOptions: {
      tolerant: true,
      customSyntax: {
        properties: {
          composes: "<custom-ident>+ [ from <string> ]?",
          "corner-shape":
            "[ round | squircle | square | bevel | scoop | notch | superellipse( <number> ) ]{1,4}",
        },
      },
    },
    rules: {
      // Custom properties live in index.css, not per file
      "css/no-invalid-properties": ["error", { allowUnknownVariables: true }],
      "css/use-baseline": "off",
    },
  },
]);
