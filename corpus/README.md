# Golden corpus

The labeled document set that IS the extraction spec (Blueprint §9). Every
merge is graded against it; if per-field accuracy regresses, CI goes red.

## Layout

```
corpus/
  manifest.json            # index: id → ground-truth path + pdf sha256/bytes/bucket key
  ground-truth/*.json      # human-labeled truth, one per document (committed — private repo)
  pdfs/                    # the actual PDFs — GITIGNORED, never in git
  synthetic/               # M1.5 generated fixtures (PDFs gitignored likewise)
```

- Format is defined and validated by `@credexis/schema`
  (`packages/schema/src/corpus/ground-truth.ts`). Validate any hand edit with
  the intake CLI (M1.2) before committing.
- **PDFs never enter git** (PII + size). They live locally under `pdfs/` and
  sync to a private Supabase Storage bucket once M0.5 provisioning lands; the
  manifest's `pdf_sha256` binds every label to the exact file bytes either way.
  (The task list suggested git-lfs pointers; a plain gitignored dir + hashed
  manifest achieves the same integrity without LFS setup — revisit if the
  corpus outgrows local sync.)
- `ground-truth/*.json` are committed to this **private** repo so labels are
  versioned and reviewable in PRs.

## Iron rules (from CLAUDE.md)

1. **Never edit ground truth to make an eval pass** (Iron Law #9). Fix the
   extractor, the registry, or the prompt — not the answer key. A ground-truth
   correction is only legitimate when the original label itself was wrong, and
   must be justified in its own PR.
2. **Synthetic fixtures never count in accuracy claims.** Anything under
   `synthetic/` carries `synthetic: true` in its ground truth; the eval harness
   segregates them mechanically.
3. Labels bind to `pdf_sha256`. Re-scanning or re-redacting a PDF changes its
   hash → relabel or re-verify; the eval harness refuses mismatches.

## Adding a document

Use the intake CLI (M1.2): drop the PDF, fill the YAML template, run the
validator + redaction check, commit the generated ground-truth JSON + manifest
update. Labeling guidance for M1.3 lives in the CLI's `--help`.
