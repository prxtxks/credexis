# ADR-0004: The taxonomy grows by evidence, through a human gate

Status: ACCEPTED (Pratik, 2026-08-12) - "we need a growing list...
with checks and tests. bulletproof."

## Context

Real clients bring unimagined businesses; a frozen ~200-node chart of
accounts will meet lines it cannot hold (Snow Removal, Lottery
Commission, POS System Fees all appeared in one week of real
documents). But a taxonomy that mutates freely is worse than one that
is too small: metrics computed against different category sets are not
comparable across deals or across time, the add-back engine keys on
specific nodes, and an LLM inventing categories per-document is
uncontrolled vocabulary drift wearing a convenience costume.

## Decision: self-EXPANDING pipeline, never self-MUTATING taxonomy

Two learning layers, one human gate:

1. **Mappings learn freely (already live).** learned_mappings grows
   label→node associations from reviewer confirmations. Vocabulary is
   fixed; only the routing learns. Guarded by leafOnly() and the
   review queue (M14.6).
2. **Vocabulary grows by evidence, behind the gate.** The signal is
   the unmapped-label ledger: printed labels that recur unmapped
   across ≥2 distinct real documents are candidates. A human (Pratik)
   approves each addition. The SAME PR must carry:
   - the node in packages/schema/src/seed/taxonomy.ts (stable dotted
     key, never renamed later; parent must exist; leaf placement);
   - seeds.test.ts invariants passing (count band, unique keys/sort
     orders, parents resolve, addback keys exist);
   - prod seed applied (idempotent upsert by key);
   - relabeling of any corpus GT lines the node unblocks, via the
     draft→human-tick flow (never silently);
   - DOMAIN-RULINGS.md entry when the addition encodes an
     underwriting judgment.

## Rules that make it bulletproof

- Keys are identities: add-only, no renames, no deletions; a mistaken
  node is deprecated (excluded from mapper suggestions), not removed.
- Engine treatment is automatic for is.opex._ / is.other._ leaves
  (rollup by parent), but any addback-relevant node MUST be flagged
  isAddbackRelevant and reviewed against FIRST_CLASS_ADDBACK_KEYS.
- The mapper only ever suggests; mixed/ambiguous lines refuse per
  ruling #2. New nodes never auto-relabel history - facts are
  append-mostly, so remapping is a new suggestion, not a mutation.
- Labeling drafts take vocabulary from the canonical seed (the whole
  seed, not just previously-used nodes - the batch-2/3 lesson).

## Consequences

- An "unmapped label ledger" report (labels + doc counts + deals) is
  the standing input to a periodic 10-minute review with Pratik.
- Adding a node is a ~30-minute PR, most of it the GT relabel pass.
- Rejected candidates get recorded (label → nearest node or
  "stays-in-review") so the same question is never re-asked.
