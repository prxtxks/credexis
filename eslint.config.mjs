// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import moneyPlugin from "./tooling/eslint-rules/no-raw-money-arithmetic.mjs";

/**
 * Root flat config — lints the entire workspace from one source of truth.
 * The money-safety rule (Iron Law #2) is layered on in M0.6; this is the base.
 * Prettier is last so formatting rules never fight the formatter.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Money-safety (Iron Law #2 / standing order #3). Type-aware, so scoped to
  // package source files that participate in a tsconfig. Never disable.
  {
    files: ["packages/engine/src/**/*.ts", "packages/shared/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.typetest.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { money: moneyPlugin },
    rules: {
      "money/no-raw-money-arithmetic": "error",
    },
  },
  eslintConfigPrettier,
);
