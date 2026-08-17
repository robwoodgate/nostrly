import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-config-prettier";

const unusedVarsOptions = { argsIgnorePattern: "^_", caughtErrors: "none" };

export default [
  { ignores: ["assets/", "vendor/", "node_modules/"] },
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2021,
      globals: { ...globals.browser, ...globals.jquery },
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", unusedVarsOptions],
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      // tsc checks undefined identifiers; core rules false-positive on types
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", unusedVarsOptions],
    },
  },
  {
    files: ["webpack.config.js", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
];
