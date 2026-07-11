// @ts-check
import { ESLintUtils } from "@typescript-eslint/utils";

/**
 * Type-aware ESLint rule: forbid raw arithmetic operators on money types
 * (`Cents`, `FixedDecimal`). Money math must route through the
 * @credexis/shared helpers (addCents, subCents, mulCentsByRatio,
 * divideCentsToDecimal, …) so the rounding policy stays centralized and no
 * float can contaminate money. Iron Law #2 / standing order #3 — never disable.
 *
 * The money utility's own internals are safe: they unwrap `Cents` to `bigint`
 * before using operators, so the operands there are plain bigint and this rule
 * does not fire.
 */

const MONEY_TYPE_NAMES = new Set(["Cents", "FixedDecimal"]);
const BINARY_ARITHMETIC = new Set(["+", "-", "*", "/", "%", "**"]);
const ASSIGN_ARITHMETIC = new Set(["+=", "-=", "*=", "/=", "%=", "**="]);
const UNARY_ARITHMETIC = new Set(["-", "+"]);

/**
 * @param {import("typescript").Type} type
 * @param {Set<string>} out
 */
function collectTypeNames(type, out) {
  if (!type) return;
  if (type.aliasSymbol) out.add(type.aliasSymbol.getName());
  const symbol = type.getSymbol?.();
  if (symbol) out.add(symbol.getName());
  if (typeof type.isUnionOrIntersection === "function" && type.isUnionOrIntersection()) {
    for (const member of type.types) collectTypeNames(member, out);
  }
}

const rule = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw arithmetic operators on money types (Cents/FixedDecimal); use the @credexis/shared money helpers.",
    },
    messages: {
      rawMoneyArithmetic:
        "Do not use '{{op}}' directly on money values ({{typeName}}). Use the @credexis/shared money helpers (addCents, subCents, mulCentsByRatio, divideCentsToDecimal, …) so rounding stays explicit and no float can contaminate money.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);

    /** @param {import("@typescript-eslint/utils").TSESTree.Node} node */
    function moneyTypeName(node) {
      const type = services.getTypeAtLocation(node);
      const names = new Set();
      collectTypeNames(type, names);
      for (const name of names) {
        if (MONEY_TYPE_NAMES.has(name)) return name;
      }
      return null;
    }

    return {
      /** @param {import("@typescript-eslint/utils").TSESTree.BinaryExpression} node */
      BinaryExpression(node) {
        if (!BINARY_ARITHMETIC.has(node.operator)) return;
        const typeName = moneyTypeName(node.left) ?? moneyTypeName(node.right);
        if (typeName) {
          context.report({
            node,
            messageId: "rawMoneyArithmetic",
            data: { op: node.operator, typeName },
          });
        }
      },
      /** @param {import("@typescript-eslint/utils").TSESTree.AssignmentExpression} node */
      AssignmentExpression(node) {
        if (!ASSIGN_ARITHMETIC.has(node.operator)) return;
        const typeName = moneyTypeName(node.left) ?? moneyTypeName(node.right);
        if (typeName) {
          context.report({
            node,
            messageId: "rawMoneyArithmetic",
            data: { op: node.operator, typeName },
          });
        }
      },
      /** @param {import("@typescript-eslint/utils").TSESTree.UnaryExpression} node */
      UnaryExpression(node) {
        if (!UNARY_ARITHMETIC.has(node.operator)) return;
        const typeName = moneyTypeName(node.argument);
        if (typeName) {
          context.report({
            node,
            messageId: "rawMoneyArithmetic",
            data: { op: node.operator, typeName },
          });
        }
      },
    };
  },
});

export default { rules: { "no-raw-money-arithmetic": rule } };
