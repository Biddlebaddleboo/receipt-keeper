# Frontend-first receipt extractor benchmark

This report covers the classical frontend field extractor added in `src/lib/receiptFrontendExtractor.ts` and the backend hand-off in the sibling `ai-receipt-tracker-backend` repository.

## Corpus and protocol

- 500 receipts from the public [ICDAR 2019 SROIE repository](https://github.com/zzzDavid/ICDAR-2019-SROIE), with the repository's OCR box text and key labels. The image/OCR cache is ignored and is not committed.
- 52 historical receipt images were downloaded read-only from `gs://ai-receipt-tracker/receipts/**`. They have no reliable paper/field ground truth, so they are used for coverage, abstention, and manual-review-queue checks only. Production objects were not modified.
- The public sample is split at receipt level into 301 tuning, 100 validation, and 99 untouched final records. Three exact-duplicate groups were detected; each group is assigned wholly to the representative's split rather than leaking across boundaries, which shifts one record from the nominal final slice into tuning. No customer images are committed. The production corpus is kept group-local and is never mixed with the public final set.
- The final set is not used to choose thresholds. Where a physical paper or field boundary cannot be determined automatically, the result is classified as review-required rather than treating the current crop or AI value as truth.

## Before / after

The “before” system has no trusted browser fields: every receipt enters the existing whole-receipt GPT extraction path. The “after” system runs browser OCR plus independent labelled-line rules and sends only unresolved fields to GPT. Manual values are trusted only as explicit user review.

The benchmark command is:

```text
npm run benchmark:receipt-frontend
npm run benchmark:receipt-frontend:browser-ocr
```

The first command scores all 500 reference OCR records quickly. The second runs the same extractor through Tesseract.js over all 500 images and all cached production images; its JSONL output is ignored because production-derived OCR is sensitive.

Reference-OCR proxy results for the selected conservative rules (500 records; subtotal/tax are not labelled by SROIE and are therefore not assigned precision/recall):

| field | trusted | precision | recall |
| --- | ---: | ---: | ---: |
| store name | 0 | n/a | 0.0% |
| date | 200 | 99.1% | 40.1% |
| subtotal | 83 | n/a | n/a |
| tax | 168 | n/a | n/a |
| total | 217 | 60.6% | 26.3% |

Actual Tesseract.js image benchmark results over all 500 images, rescored from the raw OCR text with the locked parser:

| field | trusted | precision | recall |
| --- | ---: | ---: | ---: |
| store name | 2 | 100.0% | 0.4% |
| date | 211 | 88.8% | 39.1% |
| subtotal | 89 | n/a | n/a |
| tax | 216 | n/a | n/a |
| total | 246 | 64.5% | 31.7% |

All 500 public records and all 52 production records had at least one unresolved field, so the current conservative configuration made 500/500 and 52/52 partial GPT fallbacks and 0/500 and 0/52 zero-GPT uploads. It did not silently force a complete extraction. Re-scoring raw browser OCR with the locked parser trusted 764/2500 fields (30.6%) on the public images and 73/260 (28.1%) on production images, which is the current estimated field-level token/work reduction; extraction-call reduction is 0% until a receipt has all five independently trusted or manually reviewed fields.

The strict parser intentionally abstains heavily on noisy OCR. The measured browser-OCR precision is below the requested autonomous-trust target, so this configuration should be treated as a review/partial-GPT optimization rather than evidence for silently accepting all fields. No 99.5% or 99.9% retention claim is made.

## Safety and cost metrics

| metric | legacy path | frontend-first path |
| --- | ---: | ---: |
| browser field confidence | none | independent per field; 0.92 minimum for OCR/rule trust |
| GPT fallback | 100% | 100% in this benchmark; only when at least one field remains unresolved |
| GPT calls when all five fields are reviewed | 1 | 0 |
| estimated extraction prompt tokens | full field + items prompt | short plain-text prompt listing unresolved fields only |
| estimated field-level prompt/work reduction | 0% | 29.2% public / 28.1% production |
| estimated token saving for a no-AI upload | 0% | 100% of extraction prompt/call (0 no-AI cases observed) |
| real production field ground truth | unavailable | review queue required |

Crop safety remains fail-open. The existing [real-corpus crop report](./receipt-crop-real-report.md) records 5 known pre-change clipping failures (including Walmart-like bottom date/time/footer cases) and 0 known clipping failures after the asymmetric bottom guard, lower-fragment rejection, and below-crop content scan. The root cause was treating the strongest connected printed-content component as the physical paper boundary; faint thermal footer text and whitespace broke that component. This extractor does not use crop success, subtotal, date, or any other field to raise another field's confidence.

## Difficult cases

White/light paper, shadows, glare, crumpling, long thermal receipts, perspective, partial receipts, already-cropped images, frame-edge contact, multiple papers, coloured paper, and low contrast remain explicit review categories. Walmart receipts with faint bottom date/time/footer text are especially important: the crop detector must preserve the original when the paper boundary is uncertain, and field extraction must leave ambiguous footer values unresolved for GPT.

## Implementation and remaining work

- Browser OCR is lazy-loaded with Tesseract.js; failure returns five unresolved fields and preserves fail-open behavior.
- Rules require a unique explicit label for subtotal, tax, and total. Tax is never calculated from other amounts.
- Backend validates each trusted field independently, merges GPT output only into the unresolved set, skips GPT when that set is empty, and uses a short plain-text unresolved-field prompt for partial fallback.
- The partial GPT path currently sends the whole receipt because field regions are not safely known for all layouts; this preserves context for long receipts. Region crops can be added after OCR bounding-box review proves they do not hide labels or footer context.
- Known limitation: reference OCR contains many adjacent label/value lines and non-standard total labels. The parser handles the adjacent-line case but remains conservative on ambiguous vendor/date/amount text; these are intended abstentions, not silent guesses.
