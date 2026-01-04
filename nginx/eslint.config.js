import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist", "static", "node_modules", "src/droppr-panel.js", "droppr-panel.js"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    plugins: {
      prettier: prettier,
    },
    rules: {
      "prettier/prettier": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // Specific config for TypeScript files with Type Checking
  {
    files: ["src/**/*.ts", "vite.config.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  // Disable type checking for other JS/TS files that are not in tsconfig
  {
    files: ["**/*.js", "tests/**/*.js", "eslint.config.js", "vitest.config.js"],
    rules: {
      "@typescript-eslint/no-var-requires": "off",
    },
    languageOptions: {
      parserOptions: {
        project: null, // Disable type checking
      },
    },
  },
  eslintConfigPrettier
);
