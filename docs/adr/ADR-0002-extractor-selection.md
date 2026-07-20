# ADR-0002: Extraction vendor selection (Path 1)

- **Status:** Proposed — awaiting [PRATIK] sign-off (M3.4)
- **Date:** 2026-07-20
- **Deciders:** Pratik (founder) · Claude (build agent, recommendation only)

## Context

Blueprint §4 mandates two independent extraction paths: Path 1 is a
geometry-aware document-AI vendor (per-field bounding boxes, table
structure), Path 2 is a vision LLM (Claude). The consensus reconciler
compares them; agreement auto-accepts, disagreement goes to review. M3.4
requires choosing the Path-1 primary **with data, not marketing**: every
candidate over the real corpus through the eval harness (M1.4), scored
against human-verified ground truth.

Corpus at decision time: 9 real documents, 160 labeled fields — three
1120-S (2023 native + scanned, 2024 native), three 1040 (2024 native,
Schedule E filers), one balance sheet, two P&Ls (annual + half-year).
Two more hotel P&Ls (monthly, T12) enter after domain review; the
scorecard re-runs then. Notably absent: 1065, 1120, K-1s — the registry
for those is also still numbering-unverified, so this ADR selects for
the MVP families only and is explicitly revisitable.

Candidates: **Reducto** (all families + statement grids), **Azure
Document Intelligence prebuilt-tax** (1040 family), **Claude solo**
(vision, no geometry), and the **consensus system** (the product).

## Decision

**Recommendation: Reducto as the Path-1 primary for all MVP families,
including the 1040 family.** [PRATIK] signs off or overrides.

### Round 1 (2026-07-20, whole-bundle inputs)

| Extractor            | Docs  | GT fields | Precision   | Recall | Silent wrong | Cost  |
| -------------------- | ----- | --------- | ----------- | ------ | ------------ | ----- |
| reducto-solo         | 6 tax | 114       | **100.00%** | 47.37% | 0            | $3.82 |
| claude-solo          | 6 tax | 114       | **100.00%** | 47.37% | 0            | $1.80 |
| consensus (3×1120-S) | 3     | 69        | **100.00%** | 59.42% | 0            | $1.60 |
| azure-solo           | —     | —         | failed      | —      | —            | —     |

### What the data says

1. **Precision is a solved problem; recall is the frontier.** Every value
   any engine extracted matched human ground truth exactly — zero wrong
   values, zero silent-wrongs, across native AND scanned documents. Both
   engines miss ~half the labeled fields (they find the same "easy" set:
   54 identical fields), so the work ahead is coverage, not correctness.
2. **Reducto ≈ Claude on accuracy; Reducto brings the geometry.** Equal
   scores, but Path 1 must supply bounding boxes for click-to-source —
   Claude alone cannot. Claude's role stays Path 2 (independent check).
3. **Azure prebuilt-tax failed on real CPA bundles**: fed a 49-page
   return package it detected zero 1040s (hallucinated 1099-R/LS forms at
   0.29 confidence), and its free tier 429-rate-limits sequential runs.
   Page-slicing (implemented after round 1) feeds it only the form's
   pages and may rehabilitate it — re-evaluate on the next corpus run
   with a paid tier. Until then, **Reducto takes the 1040 family too.**
4. **Consensus recall (59%) exceeds solo recall (47%)** on the 1120-S
   set — the union of two engines reads more than either alone, exactly
   the design intent. Auto-accept tuning (M6.2 thresholds) has real data
   to calibrate against now.
5. **Costs are far inside the Blueprint §12 envelope**: ~$0.64/doc
   (Reducto), ~$0.30/doc (Claude vision); a full deal projects to $3–6.

### Round 2 (same day) — findings that became fixes

Statement extraction scored zero end-to-end, from three compounding
causes, each now fixed or flagged: (a) period headers live in page
TITLES on real statements — binding now falls back to title text for
single-column grids and parses CPA phrasings ("January through June
30,2025", "10/31/24" T12 columns); (b) whole-bundle inputs bury the
form — the extract stage now slices each logical document's page range
before any vendor call; (c) the **Anthropic account ran out of credits
mid-round**, which aborted statement mapping entirely — the stage now
degrades to learned-mappings-only instead of losing the document, and
the credit top-up is [PRATIK]'s. Statement + post-slicing tax numbers
re-run once credits exist.

### Rounds 4–5 (post-fix, Reducto Path-1 everywhere, sliced spans)

| Metric                 | Round 1         | Round 5                                   |
| ---------------------- | --------------- | ----------------------------------------- |
| Consensus docs covered | 3 (1120-S only) | 8 of 9                                    |
| Tax precision          | 100%            | **100%**                                  |
| 1120-S recall          | 59.4%           | **63.8%**                                 |
| Statement extraction   | zero            | live (16/20 correct on the half-year P&L) |
| Cost per full row      | $1.60           | **$0.39** (4× cheaper via slicing)        |
| Silent wrong           | 0               | **0**                                     |

Field-level diagnosis on sliced pages: Reducto alone found **every**
labeled 1040/1120-S value with zero errors — the residual recall gap is
now the fact model, not the engines: derived lines (AGI, taxable income)
deliberately carry no taxonomy link and are dropped after extraction
(follow-up task: registry-only facts — since landed as M4.8). The P&L precision number (37%) is
dominated by one column-per-month statement scored against FY-total
labels — a period-granularity representation question; all its wrongs
routed to review (nothing silent). Multi-column balance sheets remain
review-owned by design.

## Consequences

- The chosen primary becomes `path1ForFamily`'s default in the pipeline
  extract stage; the loser remains an env-gated fallback (adapters are
  interchangeable behind `ExtractorAdapter` — switching is config).
- Claude-solo is measured for honesty, not as a candidate: Blueprint
  requires geometric lineage (click-to-source) that a vision LLM cannot
  provide alone.
- Azure stays scoped to the 1040 family regardless of score (its prebuilt
  model reads only that family).
- Ocrolus-class managed parsing (~5–10× COGS) remains the documented
  fallback if no candidate meets the accuracy bar (Blueprint §12).

## Revisit triggers

- Corpus growth past ~30 docs or any new form family (1065/1120/K-1).
- A candidate ships a major model revision.
- Silent-wrong > 0 in production attributable to Path-1 quality.
