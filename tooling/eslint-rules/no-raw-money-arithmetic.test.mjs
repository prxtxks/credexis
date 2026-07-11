import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import plugin from "./no-raw-money-arithmetic.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: { allowDefaultProject: ["*.ts"] },
      tsconfigRootDir: import.meta.dirname,
    },
  },
});

// A branded `Cents` alias whose alias-symbol name is what the rule keys on.
const CENTS = `type Cents = bigint & { readonly __b: never };`;

ruleTester.run("no-raw-money-arithmetic", plugin.rules["no-raw-money-arithmetic"], {
  valid: [
    // Plain bigint arithmetic (non-money) is fine.
    { code: `declare const a: bigint; declare const b: bigint; export const x = a + b;` },
    // Referencing money without operating on it is fine.
    { code: `${CENTS} declare const a: Cents; declare const b: Cents; export const x = [a, b];` },
    // Ordinary number/loop arithmetic must never be flagged.
    {
      code: `export function f(n: number) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }`,
    },
  ],
  invalid: [
    {
      code: `${CENTS} declare const a: Cents; declare const b: Cents; export const x = a + b;`,
      errors: [{ messageId: "rawMoneyArithmetic" }],
    },
    {
      code: `${CENTS} declare const a: Cents; export const x = -a;`,
      errors: [{ messageId: "rawMoneyArithmetic" }],
    },
    {
      code: `${CENTS} declare let a: Cents; declare const b: Cents; export function f() { a += b; }`,
      errors: [{ messageId: "rawMoneyArithmetic" }],
    },
  ],
});
