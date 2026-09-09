# Browser OCR comparison

Date: 2026-09-09

## Decision

Keep the existing Tesseract `sharpen-upscale` path as the production OCR
path. PP-OCRv6 tiny is a substantially better text/layout recognizer, but it
does not improve the unchanged trusted-field path enough to pay for its
browser cost: on the full public corpus it trusted 704 field slots versus
778 for Tesseract, and it still produced 54 known-wrong trusted totals. The
modern engines remain an offline benchmark harness; no production extractor
or trust threshold was changed.

## Corpus and protocol

- SROIE: all 500 public receipt images, split by receipt id/group into 301
  tuning, 100 validation, and 99 final images. Known duplicate groups were
  kept in one split.
- Production: all 52 locally cached images downloaded read-only from the GCS
  bucket, including six Walmart receipts. Production OCR text, values, and
  images are ignored locally and are not committed.
- The current Tesseract `sharpen-upscale` results are the control. Every
  modern result calls the existing `rules-only` extractor with the same
  independent field statuses; the extractor was not changed for this study.
- The v6 default run was selected after tuning/validation screening and was
  run once on the untouched 99-image final set. The final set was not used to
  select parameters.
- SROIE line/box scores use the supplied OCR box annotations and approximate
  text matching. SROIE does not provide independent subtotal/tax labels in
  this benchmark, so those trusted-field precision values are intentionally
  left unknown.

## Full-corpus result

Percentages are image/field coverage or exact-hit rates as indicated. “Trusted
slots” counts the five frontend fields per receipt; receipt-level GPT fallback
was 100% for both paths because at least one field remained unresolved.

| OCR path | n | exact store | exact date | exact total/amount | line recall / precision / IoU | trusted slots | mean unresolved | mean ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Tesseract sharpen-upscale | 500 | 66.6% | 63.4% | 80.6% | 52.8% / 92.1% / 0.419 | 778/2500 (31.1%) | 3.444 | 3,736 |
| PP-OCRv6 tiny | 500 | 78.8% | 70.9% | 90.0% | 93.3% / 96.0% / 0.608 | 704/2500 (28.2%) | 3.592 | 2,855 |

The v6 line recognizer is clearly stronger, but its extra detections expose
more candidates to the unchanged conservative extractor. That does not
translate into more safe trusted fields.

### Untouched final split (99 receipts, evaluated once)

This is the held-out result after candidate screening, not a tuning result.

| OCR path | exact store / date / total | line recall / precision / IoU | trusted slots | date precision / coverage | total precision / coverage | wrong trusted totals | mean ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Tesseract sharpen-upscale | 71.7% / 65.5% / 84.8% | 59.6% / 93.7% / 0.426 | 178/495 (35.9%) | 89.1% / 46.5% | 86.0% / 57.6% | 8 | 3,704 |
| PP-OCRv6 tiny | 86.9% / 71.4% / 85.9% | 94.6% / 96.3% / 0.650 | 161/495 (32.5%) | 100.0% / 45.5% | 84.7% / 59.6% | 9 | 2,834 |

The final result confirms the validation decision: v6 improves raw layout and
date precision, but does not improve safe trusted-field coverage and makes one
more known-wrong total.

### Trusted-field safety and coverage (all 500 SROIE images)

| Field | Tesseract trusted / precision / coverage | PP-OCRv6 trusted / precision / coverage | known-wrong trusted |
| --- | ---: | ---: | ---: |
| store | 1 / 100.0% / 0.2% | 1 / 100.0% / 0.2% | 0 / 0 |
| date | 206 / 89.8% / 41.2% | 189 / 97.4% / 37.8% | 21 / 5 |
| subtotal* | 90 / — / 18.0% | 85 / — / 17.0% | — |
| tax* | 227 / — / 45.4% | 195 / — / 39.0% | — |
| total | 254 / 76.4% / 50.8% | 234 / 76.9% / 46.8% | 60 / 54 |

\* The public SROIE labels used here do not independently label these fields.

The modern OCR path improves date precision by abstaining more often and
reduces known-wrong totals by six, but reduces total coverage and trusted
slots overall. It therefore fails the “materially better without unsafe
trusted predictions” promotion rule.

## Validation candidates

These candidate results were measured on the 100-image validation split. The
v6 high-resolution and permissive-detector rows are parameter ablations, not
production changes.

| Candidate | exact store / date / total | line recall / precision / IoU | trusted slots | date precision / coverage | total precision / coverage | wrong trusted totals | mean ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Tesseract sharpen-upscale | 60.0% / 67.0% / 74.0% | 48.0% / 94.3% / 0.432 | 140/500 (28.0%) | 87.8% / 49.0% | 70.0% / 30.0% | 9 | 3,910 |
| PP-OCRv5 mobile | 72.0% / 79.4% / 84.0% | 92.4% / 96.8% / 0.575 | 103/500 (20.6%) | 90.5% / 21.0% | 74.2% / 31.0% | 8 | 11,650 |
| PP-OCRv6 tiny | 78.0% / 78.4% / 84.0% | 92.2% / 97.3% / 0.584 | 121/500 (24.2%) | 100.0% / 35.0% | 73.3% / 30.0% | 8 | 3,316 |
| PP-OCRv6 tiny, high resolution | 79.0% / 79.4% / 85.0% | 92.9% / 97.0% / 0.596 | 115/500 (23.0%) | 100.0% / 31.0% | 80.8% / 26.0% | 5 | 3,626 |
| PP-OCRv6 tiny, permissive detector | 78.0% / 78.4% / 84.0% | 92.7% / 97.0% / 0.583 | 121/500 (24.2%) | 100.0% / 35.0% | 73.3% / 30.0% | 8 | 3,333 |

High resolution is the safest v6 ablation on this validation slice for the
known total labels, but it has lower trusted coverage than default v6 and
still does not beat the Tesseract trusted-slot rate. No ablation was promoted.

The independent Guten OCR browser / PP-OCRv4 candidate completed a one-image
smoke test (6.52 s first inference, 16.2 MB of model assets), then was stopped
at 41/100 validation images after the Chromium renderer reached approximately
4.7 GB RSS. It is not a viable mobile/browser candidate and was not scored as
an accuracy winner.

An all-image PP-OCRv5 timing sweep was also started but stopped at 128/500
after about 21 minutes. Its validation result already had lower trusted
coverage and roughly 3.5x v6’s inference time, so no v5 all-corpus accuracy is
claimed; the all-500 comparison above is intentionally limited to the
completed Tesseract control and selected v6 run.

## Browser cost and feasibility

Raw assets measured in the benchmark install; compressed transfer sizes will
vary by deployment.

Tesseract cold/first numbers are from a one-image control run with its normal
two-worker setup; its cached number is the 500-image benchmark mean.

| Runtime/model | model assets | shared runtime assets | cold init | first inference | cached inference | heap after init | observed peak JS heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Tesseract current assets | 8.2 MB | — | 1.24 s | 3.17 s | 3.74 s full-corpus mean | not captured | not captured |
| PP-OCRv5 mobile | 21.5 MB | 22.0 MB | 4.30 s | 9.71 s | 11.65 s | 218 MB | 830 MB |
| PP-OCRv6 tiny | 6.3 MB | 22.0 MB | 3.48 s | 4.21 s | 3.31 s | 189 MB | 792 MB |

The shared runtime is OpenCV.js + ONNX Runtime Web JS/WASM in the benchmark.
Runs used single-threaded CPU WASM in Chromium with GPU disabled, so WebGPU
was not credited. PP-OCRv6’s model is small enough to be interesting for a
future device-specific experiment, but the approximately 28 MB raw runtime
plus high transient heap makes it unsuitable as the default iPhone live-camera
path without a real-device memory/performance pass.

Modern adapters expose line polygons and confidence but no word boxes, so
modern word-box presence is 0. Tesseract exposed an average of 4.24 word boxes
per line on all SROIE images. This is a layout-quality limitation of the
current modern wrapper, not a claim that the modern line polygons are absent.

## Production corpus and Walmart check

The production run covered 52/52 cached GCS receipts. Image ground truth is
not available for exact field accuracy, so the following are descriptive only:

| OCR path | trusted slots | field coverage | receipt GPT fallback | Walmart receipts | Walmart fallback |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tesseract sharpen-upscale | 74/260 (28.5%) | 1 vendor, 16 dates, 13 subtotals, 21 taxes, 23 totals | 52/52 (100%) | 6 | 6/6 (100%) |
| PP-OCRv6 tiny | 79/260 (30.4%) | 0 vendor, 17 dates, 13 subtotals, 28 taxes, 21 totals | 52/52 (100%) | 6 | 6/6 (100%) |

Production output is deliberately redacted to field status/category metrics,
so these are coverage counts only and no accuracy claim is made. The modern
production run cannot show a field improvement in the absence of independent
image labels; every Walmart receipt still had unresolved fields and retained
the GPT fallback.

Across SROIE, field-level GPT work would not fall: v6 trusted 74 fewer slots,
leaving 1,796 unresolved field slots versus Tesseract’s 1,722. On production,
v6 left five fewer unresolved slots (181 versus 186), but still triggered all
52 receipt-level fallbacks and has no independent production accuracy labels.

## Limitations and remaining failure modes

- SROIE’s provided labels support store/date/total checks, not independent
  subtotal/tax checks or true paper-boundary checks.
- Production receipts are useful for realistic browser/runtime and Walmart
  coverage, but their private content is not persisted in this report.
- Modern engines return better line coverage but currently lack word-level
  boxes in the adapter. OCR can still fail on low contrast, glare, shadows,
  crumpled paper, edge-touching receipts, and partial frames.
- The unchanged frontend extractor remains intentionally conservative and can
  abstain even when OCR text is present. This is preferable to silently
  trusting a wrong amount/date.

Reproduce the offline run after downloading the ignored public/cache assets
with `npm run benchmark:receipt-modern-ocr:models`, then run the browser
runner separately for `sroie/all`, `production/all`, and the candidate splits;
score with `npm run benchmark:receipt-modern-ocr:score` and the corresponding
`RECEIPT_MODERN_OCR_SCORE_INPUT` environment variable.
