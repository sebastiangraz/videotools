import { defineConfig } from "oxlint";

export default defineConfig({
  // oxlint's defaults plus react.
  plugins: ["eslint", "typescript", "unicorn", "oxc", "react"],
  options: { typeAware: true, denyWarnings: true },
  rules: {
    "react/rules-of-hooks": "error",
    "react/only-export-components": "error",
  },
});
