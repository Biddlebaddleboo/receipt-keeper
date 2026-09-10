# Overlapping horizontal-band PP-OCRv6 tiny benchmark

The band path is an experimental, browser-safe classical selector. Production Tesseract and the existing PP-OCRv6 whole-image selectors were not changed by this benchmark.

## Corpus and protocol

- Public corpus: 500 SROIE receipts; exact duplicate groups are kept together (tuning/validation/final: 301/100/99).
- Geometry, overlap, preprocessing, selector, and the agreement gate are selected from validation labels only. The final split is not used for selection.
- SROIE independently labels store/date/total only; subtotal and tax are reported as unresolved/status measurements, not accuracy claims.
- The production corpus is the 52-image read-only GCS cache (6 coarse Walmart rows). The committed report contains no private images, OCR text, or field values.

## Controls on the public corpus

Known coverage is trusted labelled slots divided by receipts × 3 (store/date/total); unresolved field units are the potential GPT work.

| configuration | known precision | known coverage | correct / trusted | wrong trusted | mean unresolved | GPT units |
|---|---:|---:|---:|---:|---:|---:|
| tesseract-rules | 84.1% | 30.7% | 387 / 461 | 73 | 3.44 | 1722 |
| ppocrv6-old-rules | 88.0% | 28.3% | 373 / 424 | 51 | 3.59 | 1796 |
| ppocrv6-current-adapted | 97.0% | 8.9% | 129 / 134 | 4 | 4.41 | 2207 |

## Configuration screen

The screen is validation-labelled and limited to the largest available validation run per configuration. Zero wrong trusted values is a selection guard, not a statistical guarantee.

| configuration | n | known precision | known coverage | correct | wrong trusted | dedup agreement proxy | duplicate merge | inference mean (ms) | model |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| fraction30-overlap20-original-1600-band-only | 20 | n/a | 0.0% | 0 | 0 | 87.6% | 18.0% | 4913.3 | 6.03 MiB |
| fraction40-overlap30-contrast-2200-band-only | 20 | n/a | 0.0% | 0 | 0 | 91.4% | 34.5% | 6935.0 | 6.03 MiB |
| fraction40-overlap40-contrast-2200-rules-hybrid | 100 | 100.0% | 25.3% | 76 | 0 | 85.3% | 59.1% | 11023.4 | 6.03 MiB |
| fraction40-overlap50-contrast-2800-whole-plus-band | 20 | n/a | 0.0% | 0 | 0 | 85.8% | 62.8% | 12142.6 | 6.03 MiB |
| fraction50-overlap40-sharpen-2200-band-only | 20 | n/a | 0.0% | 0 | 0 | 91.3% | 38.7% | 6898.0 | 6.03 MiB |
| fraction50-overlap60-adaptive-2200-whole-plus-band | 20 | n/a | 0.0% | 0 | 0 | 72.1% | 66.6% | 12506.7 | 6.03 MiB |
| line-heights4-overlap40-original-2200-band-only | 20 | n/a | 0.0% | 0 | 0 | 83.8% | 35.6% | 7493.3 | 6.03 MiB |
| line-heights6-overlap50-contrast-2800-whole-plus-band | 20 | n/a | 0.0% | 0 | 0 | 83.4% | 62.0% | 12848.8 | 6.03 MiB |
| pixels480-overlap40-sharpen-2800-whole-plus-band | 20 | n/a | 0.0% | 0 | 0 | 82.4% | 58.0% | 11399.6 | 6.03 MiB |

Validation-selected configuration: **fraction40-overlap40-contrast-2200-rules-hybrid** (fraction40 height, 40% overlap, contrast, whole-image plus bands, rules + adapted ML hybrid, two independent observations).

## Selected configuration: untouched final and full 500

Untouched final split (99 receipts; evaluated with the selected gate):

| field | trusted | precision | recall | trusted coverage | wrong trusted |
|---|---:|---:|---:|---:|---:|
| vendor | 0 | n/a | 0.0% | 0.0% | 0 |
| purchase_date | 51 | 100.0% | 60.7% | 51.5% | 0 |
| subtotal | 9 | n/a | n/a | 9.1% | 0 |
| tax | 18 | n/a | n/a | 18.2% | 0 |
| total | 23 | 100.0% | 23.2% | 23.2% | 0 |

All 500 receipts (500; includes tuning, validation, and final):

| field | trusted | precision | recall | trusted coverage | wrong trusted |
|---|---:|---:|---:|---:|---:|
| vendor | 0 | n/a | 0.0% | 0.0% | 0 |
| purchase_date | 247 | 96.3% | 53.5% | 49.4% | 9 |
| subtotal | 88 | n/a | n/a | 17.6% | 0 |
| tax | 152 | n/a | n/a | 30.4% | 0 |
| total | 114 | 94.7% | 21.4% | 22.8% | 6 |

Validation slice of selected replay (100 receipts): 100.0% known precision, 25.3% known coverage, 0 wrong trusted.

Frozen selector/gate comparison on validation (used only to choose the gate):
| selector/gate | known trusted | correct | wrong trusted | precision | coverage | mean unresolved |
|---|---:|---:|---:|---:|---:|---:|
| adapted-min2 | 32 | 32 | 0 | 100.0% | 10.7% | 4.40 |
| adapted-min3 | 6 | 6 | 0 | 100.0% | 2.0% | 4.73 |
| adapted-min4 | 0 | 0 | 0 | n/a | 0.0% | 4.97 |
| rules-hybrid-min2 | 76 | 76 | 0 | 100.0% | 25.3% | 3.68 |
| rules-hybrid-min3 | 54 | 54 | 0 | 100.0% | 18.0% | 4.03 |
| rules-min2 | 48 | 48 | 0 | 100.0% | 16.0% | 4.00 |

Frozen selector/gate comparison on all 500 (not retuned and not used to select the configuration):
| selector/gate | known trusted | correct | wrong trusted | precision | coverage | mean unresolved |
|---|---:|---:|---:|---:|---:|---:|
| adapted-min2 | 56 | 52 | 3 | 94.5% | 3.7% | 4.60 |
| adapted-min3 | 12 | 10 | 2 | 83.3% | 0.8% | 4.76 |
| adapted-min4 | 0 | 0 | 0 | n/a | 0.0% | 4.98 |
| rules-hybrid-min2 | 361 | 344 | 15 | 95.8% | 24.1% | 3.80 |
| rules-hybrid-min3 | 253 | 246 | 7 | 97.2% | 16.9% | 4.12 |
| rules-min2 | 366 | 353 | 12 | 96.7% | 24.4% | 3.79 |

Known all-corpus wrong trusted values are 15: 9 dates and 6 totals. The selected final slice has 0 known wrong trusted values.

## Runtime and browser cost

Selected public run: 10705.4 ms mean OCR inference, 14713.0 ms p95 inference, 943.3 ms mean preparation, 11702.7 ms mean total, 16411.0 ms p95 total.
Production run cold initialization: 3024.1 ms; 12576.5 ms mean OCR inference, 16317.4 ms p95 inference, 204.47 MiB mean after-row JS heap, 289.24 MiB max observed after-row heap.
PP-OCRv6 tiny assets: 6.03 MiB model + 20.97 MiB shared browser runtime.
This cost is desktop single-threaded WASM for five OCR inputs per receipt; it is not suitable for synchronous live-camera use without an explicit budget/fallback.

## Production corpus

| corpus | receipts | trusted slots | trusted field rate | mean unresolved fields | fallback receipts | vendor | date | subtotal | tax | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 52 | 64 | 24.6% | 3.77 | 52/52 (100.0%) | 0 | 29 | 5 | 14 | 16 |
| Walmart | 6 | 9 | 30.0% | 3.50 | 6/6 (100.0%) | 0 | 2 | 1 | 2 | 4 |
| other | 46 | 55 | 23.9% | 3.80 | 46/46 (100.0%) | 0 | 27 | 4 | 12 | 12 |
No production accuracy claim is made: the bucket corpus has no independent field labels. Counts are status inventory only; Walmart rows have no known clipping/field-error ground truth here.

## Deduplication and GPT work

Selected public deduplication: 73932 raw lines -> 29954 merged lines (59.5% duplicate merge rate), 25164 multi-band groups, 87.1% compatible-text agreement proxy, mean 2.50 supports per merged line.
The agreement figure is a text/value compatibility proxy, not a labelled deduplication accuracy measure. A cluster can report many raw supports, but only distinct observation keys/bands count toward field agreement; merged-deduplicated output never supplies an independent vote.
Against SROIE's public line-box annotations, merged-line matching is 25784/27067 (95.3% reference recall; 86.1% prediction match rate), mean matched box IoU 0.721. This is a public OCR/layout diagnostic, not a receipt-content retention label.
Mean unresolved work is 3.80 fields/receipt (1899 units) versus 4.41 for current adapted whole-image PP-OCRv6 (14.0% fewer). It is 3.44 for Tesseract rules, so the band path does not reduce GPT work relative to Tesseract on this corpus. Receipt-level fallback remains 100.0% because every receipt has at least one unresolved field.

## Offline selector model comparison

| field | model | validation precision / coverage / wrong | untouched final precision / coverage / wrong | model bytes |
|---|---|---|---|---:|
| vendor | logistic | n/a / 0.0% / 0 | n/a / 0.0% / 0 | 517 |
| vendor | stump-forest | n/a / 0.0% / 0 | n/a / 0.0% / 0 | 1329 |
| vendor | boosted-stumps | n/a / 0.0% / 0 | n/a / 0.0% / 0 | 1148 |
| purchase_date | logistic | 100.0% / 30.0% / 0 | 97.9% / 47.5% / 1 | 585 |
| purchase_date | stump-forest | 100.0% / 29.0% / 0 | 97.8% / 45.5% / 1 | 1345 |
| purchase_date | boosted-stumps | 100.0% / 1.0% / 0 | n/a / 0.0% / 0 | 1151 |
| total | logistic | 100.0% / 1.0% / 0 | 100.0% / 2.0% / 0 | 624 |
| total | stump-forest | n/a / 0.0% / 0 | n/a / 0.0% / 0 | 1361 |
| total | boosted-stumps | 100.0% / 1.0% / 0 | n/a / 0.0% / 0 | 1149 |
The comparison uses per-field candidate/value models after a per-field presence check; only inexpensive handcrafted OCR/layout features are used. SROIE has no subtotal/tax labels, so those fields are not supervised. None of the forest/boosted candidates clears the conservative frozen-final safety check, so no heavier model is shipped.

## Decision and limitations

The band path remains experimental: the validation-selected gate is 100.0% precision and 25.3% known coverage, but the full 500 is 95.8% precision with 15 wrong trusted values. The untouched final slice is 100.0% precision at 24.9% coverage, but n=99 is not enough to generalize a 99.5%/99.9% claim.
A stricter three-independent-band gate reduces all-corpus wrong trusted values to 7 but also reduces known coverage to 16.9%; it still does not meet the safety bar. The band path is therefore not promoted to production, preserving fail-open behavior.
Observed public failure modes are ambiguous/misread dates (9) and total selection errors (6); the total-context guard blocks supply/tax-summary/rounding-summary candidates. Subtotal/tax and production Walmart correctness require independent labels or review. No 99.5%/99.9% retention claim is made.
