import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "react", "import"],
  options: { typeAware: true },
  categories: { correctness: "error" },
  ignorePatterns: ["**/dist/", ".vercel/", ".smoke/", "api/_bin/", "**/*.d.ts"],
  rules: {
    "no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
  },
  overrides: [
    {
      files: ["client/**/*.{ts,tsx}"],
      env: { browser: true },
      rules: {
        "react/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
        "react/only-export-components": "error",
      },
    },
    // Vitest `globals: true` (client/vite.config.ts)
    {
      files: ["client/**/*.test.{ts,tsx}"],
      env: { browser: true, vitest: true },
    },
    {
      files: [
        "api/**",
        "scripts/**",
        "client/vite.config.ts",
        "oxlint.config.ts",
      ],
      env: { node: true },
    },
    // typeAware is all-or-nothing; these type-aware rules are for api/ only.
    {
      files: ["client/**", "scripts/**"],
      rules: {
        "typescript/no-floating-promises": "off",
        "typescript/no-base-to-string": "off",
        "typescript/restrict-template-expressions": "off",
        "typescript/unbound-method": "off",
        "typescript/no-misused-spread": "off",
      },
    },
  ],
});
