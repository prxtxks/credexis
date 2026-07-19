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
  // Engine purity boundary (M7.1, Iron Law #3): the calc engine is pure —
  // zero I/O, zero ORM, zero framework. Only @credexis/shared and relative
  // imports may enter. Allowlist via gitignore-style negation.
  {
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Node builtins = I/O escape hatches; the other workspace
              // packages drag in the ORM, vendors, or the framework. pnpm's
              // strict node_modules blocks anything not in package.json, so
              // this list plus the single declared dep IS the allowlist.
              group: [
                "node:*",
                "fs",
                "fs/*",
                "path",
                "os",
                "http",
                "https",
                "net",
                "child_process",
                "worker_threads",
                "crypto",
                "stream",
                "url",
                "util",
                "process",
                "@credexis/schema",
                "@credexis/extraction",
                "@credexis/pipeline",
                "@credexis/corpus-tools",
                "@credexis/eval",
              ],
              message:
                "The engine is pure (Iron Law #3): only @credexis/shared and relative imports are allowed inside packages/engine.",
            },
          ],
        },
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
  // Node CLI scripts (package scripts/, tooling) run under plain Node.
  {
    files: ["**/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  eslintConfigPrettier,
);
