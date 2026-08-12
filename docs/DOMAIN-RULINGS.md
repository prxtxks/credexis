# Domain rulings — the underwriting authority's answer key decisions

Rulings by Pratik (underwriting authority). Each one binds the golden
corpus AND product behavior. GT edits citing a ruling here are domain
corrections, never eval-chasing (Iron Law #9 stays intact: we change
the key because underwriting says the old reading was wrong, and we
record why, before looking at any score).

## 1. Payroll taxes are semantic, not positional (2026-08-12)

Hospitality Jeff annual P&L prints "Total Payroll Taxes 9,997.94" as a
subsection, with "571 Payroll Taxes - Unemployment 712.80" printed
outside it. Ruling: the category follows what the expense IS, not where
the accountant filed it → is.opex.payroll_taxes = 10,710.74.
General principle: when multiple printed lines are semantically one
taxonomy node, the node's GT is their sum, each source line noted.
Applied to pnl-annual-native-001 (yaml + corpus json).

## 2. Mixed-category lines are never force-classified (2026-08-12)

"Total 66000 Payroll Expenses 12,592.28" (processing fees + payroll
taxes in one printed number, unsplittable from the paper). Ruling: keep
the refusal - the system routes it to human review rather than guess.
This is product behavior AND labeling rule: such lines stay unlabeled
in GT, recorded as flags. "We never guess" is the auditability wedge.

## 3. The taxonomy grows by evidence, through a human gate (2026-08-12)

Ruling: yes, grow the taxonomy - but never silently. Additions require
(a) evidence: the label recurs on real documents across deals,
(b) a human yes, (c) the same PR updates seeds + tests + any GT that
the new node unblocks. First addition under this ruling:
is.opex.small_equipment ("Small Tools and Equipment", printed on both
Niyazi P&L years). See ADR-0004 for the growth loop design.

Corollary discovered the same day: most "missing node" flags in
batch-2/3 were false - the canonical taxonomy (packages/schema/src/
seed/taxonomy.ts, ~200 nodes) already had travel, meals, uniforms,
officer_comp, property_taxes, accounting_fees, bad_debt, contract
labor, telephone_internet, software, and the balance-sheet detail
nodes. Labeling drafts must take their vocabulary from the canonical
seed, not from previously-used-in-GT nodes only.
