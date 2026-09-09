# Frontend OCR pipeline benchmark

## Decision

The live browser OCR path now uses one whole-image sharpened pass: grayscale
luminance, 2nd/98th percentile contrast stretch, a cheap four-neighbor unsharp
mask, a 2,800-pixel long-side cap with at most 1.5x scaling, Tesseract
page-segmentation mode 6, and its small automatic skew option. It preserves
line/word boxes and OCR confidence in source-image coordinates. The existing
independent rules and shadow ML trust gates are unchanged. OCR errors still
fail open to unresolved fields.

This was selected on the 100-receipt validation split. It was not selected from
the final split or from production-derived metadata. The public final split was
also run as a separate 99-receipt check after selection. No 99.5% or 99.9% safety claim is
made: this OCR corpus does not provide a sufficient independent safety label
for every trusted field, and the observed trusted-field precision is below
that bar.

## Corpus and protocol

- Public: all 500 SROIE receipt images, labels, and OCR boxes. Duplicate groups
  were kept within one split: 301 tuning, 100 validation, and 99 final.
- Production: 52 historical receipt images cached read-only from the
  application GCS bucket. Six are identified as Walmart. Forty-four have
  vendor/date values in application metadata; those values are descriptive
  references, not independent image ground truth. Production images and OCR
  output are ignored and are not committed.
- Control: the previous call shape, `worker.recognize(source, {}, { blocks:
  true })`, with no image preprocessing.
- Line quality: SROIE OCR-box text matching, line recall/precision, and mean
  matched bounding-box IoU. “Raw amount hit” means the labelled total amount
  appeared in OCR text; it is not trusted extraction accuracy.
- Trusted field metrics are scored only for SROIE's labelled store/date/total.
  SROIE does not supply independent subtotal/tax labels. Unknown production
  boundaries remain review work rather than assumed truth.

## Validation candidate screen

Rules trusted fields are shown as `date count/precision`, `total
count/precision`; subtotal and tax are counts only.

| strategy | mean ms | line recall / precision / box IoU | date | total | subtotal / tax |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 2,955 | 0.470 / 0.937 / 0.421 | 54 / 83.3% | 27 / 66.7% | 19 / 30 |
| deskew | 3,331 | 0.469 / 0.938 / 0.418 | 52 / 84.6% | 28 / 60.7% | 20 / 30 |
| contrast | 3,429 | 0.480 / 0.943 / 0.436 | 47 / 87.2% | 29 / 69.0% | 21 / 34 |
| contrast-lite (2,200px/1.25x) | 3,018 | 0.482 / 0.947 / 0.440 | 47 / 93.6% | 32 / 59.4% | 22 / 28 |
| adaptive threshold | 3,094 | 0.480 / 0.921 / 0.417 | 50 / 84.0% | 31 / 54.8% | 21 / 34 |
| sharpen + upscale | 3,910 | 0.480 / 0.943 / 0.432 | 49 / 87.8% | 30 / 70.0% | 21 / 40 |
| sparse-text segmentation | 4,261 | 0.842 / 0.774 / 0.431 | 42 / 92.9% | 38 / 44.7% | 15 / 37 |
| footer-only region | 1,595 | 0.142 / 0.914 / 0.323 | 8 / 62.5% | 13 / 30.8% | 0 / 53 |
| financial-only region | 2,126 | 0.068 / 0.344 / 0.004 | 1 / 100% | 14 / 7.1% | 1 / 5 |
| top-only region | 1,765 | 0.061 / 0.398 / 0.017 | 1 / 100% | 6 / 0% | 0 / 1 |

Sharpen + upscale was selected on validation and confirmed in the full-corpus
comparison: it narrowly improved labelled date and total precision over contrast and increased the
trusted total/date/tax coverage balance enough to justify its roughly 15%
preprocessing/runtime cost. The smaller contrast variant was rejected because
its total precision fell to 59.4%. Adaptive, deskew, sparse-text, and targeted
regions were rejected. Targeted regions are not safe as standalone passes
because they omit context and introduce false financial/date matches.

## SROIE before/after

The full 500-image pass is descriptive after the validation choice. Runtime is
reported from the fresh 100-image validation run because the historical full
baseline cache did not record per-image durations.

| metric | baseline | sharpen + upscale |
| --- | ---: | ---: |
| raw store text hit | 65.2% | 66.6% |
| raw date text hit | 63.2% | 63.4% |
| raw labelled-total amount hit | 78.4% | 80.6% |
| line recall / precision | 51.9% / 91.3% | 52.8% / 92.1% |
| mean matched box IoU | 0.428 | 0.419 |
| mean OCR runtime (validation) | 2.83s | 3.91s |
| OCR error rate | 0% | 0% |
| receipt with unresolved field | 100% | 100% |

| field | baseline trusted / precision / recall / coverage | sharpen trusted / precision / recall / coverage |
| --- | ---: | ---: |
| store | 2 / 100.0% / 0.4% / 0.4% | 1 / 100.0% / 0.2% / 0.2% |
| date | 211 / 89.4% / 42.0% / 42.2% | 206 / 89.8% / 41.5% / 41.2% |
| subtotal* | 89 / n/a / n/a / 17.8% | 90 / n/a / n/a / 18.0% |
| tax* | 216 / n/a / n/a / 43.2% | 227 / n/a / n/a / 45.4% |
| total | 246 / 74.3% / 36.5% / 49.2% | 254 / 76.4% / 38.9% / 50.8% |

\* No independent SROIE ground truth exists for these fields. The combined
rules + shadow-ML output was identical to the rules trusted counts; the ML
path supplied no safe additional trusted coverage and remains shadow-only.
Trusted field slots increased from 764/2,500 (30.6%) to 778/2,500 (31.1%),
but all receipts still had at least one unresolved field, so the estimated
receipt-level GPT fallback rate remained 100%. The benefit is a smaller
unresolved-field prompt, not fewer extraction calls on this corpus.

The final 99-receipt check for the selected sharpen path was: store 1 at
100.0%, date 46 at 89.1% precision, total 57 at 86.0%, subtotal 11, and tax
63; line recall/precision was 59.6%/93.7% and mean matched box IoU 0.426. The
corresponding baseline cache was date 46 at 93.3%, total 52 at 84.6%, subtotal
10, tax 57, store 1, with line recall/precision 57.1%/92.7% and IoU 0.422. These final numbers are
descriptive and are not used to claim a population-wide safety rate.

## Production and difficult receipts

No production field precision is claimed because the bucket corpus has no
independent annotations. Both paths had 0% OCR errors and 100% receipt-level
partial fallback.

| metric over 52 production images | baseline | sharpen + upscale |
| --- | ---: | ---: |
| mean runtime | 4.11s | 6.02s |
| trusted store / date / subtotal / tax / total | 1 / 12 / 12 / 21 / 27 | 1 / 16 / 13 / 21 / 23 |
| trusted field slots | 73/260 (28.1%) | 74/260 (28.5%) |
| metadata-reference store/date precision | 100% / 100% | 100% / 100% |

The production result is a modest positive coverage check: compared with the
baseline, sharpen recovered four more dates and one more subtotal, while
returning four fewer trusted totals. This is not treated as proof of field
accuracy without labels; production outputs remain review work.

All six Walmart images were included. The baseline trusted a total on three
and a date on one; sharpen trusted a total on two and a date on three. No
Walmart-only or footer-only rule was added. Footer-only OCR was rejected after
it produced low validation precision and a wrong date against one of the
metadata references. The relevant likely edge cases—long thermal receipts,
faint/low-contrast text, shadows, skew, repeated amounts, footer/date lines,
and cropped or incomplete frames—therefore remain fail-open or GPT-review
cases when the strict rules cannot establish an unambiguous field.

## Reproduction

The ignored local corpus must be present before production runs. The main
commands used were:

```text
RECEIPT_OCR_DATASET=sroie RECEIPT_OCR_SUBSET=validation \
  RECEIPT_OCR_STRATEGIES=baseline,deskew,contrast,adaptive,sharpen-upscale,sparse-text \
  npm run benchmark:receipt-frontend:ocr
npm run benchmark:receipt-frontend:ocr:score
RECEIPT_OCR_DATASET=sroie RECEIPT_OCR_SUBSET=all RECEIPT_OCR_STRATEGIES=sharpen-upscale \
  npm run benchmark:receipt-frontend:ocr
RECEIPT_OCR_DATASET=production RECEIPT_OCR_SUBSET=all \
  npm run benchmark:receipt-frontend:ocr
```

The harness is offline/browser-compatible: it serves local Tesseract assets,
uses no neural model, keeps the existing rules and shadow ML extractor, and
does not write production objects. Raw images/OCR caches and diagnostic data
remain ignored; this report contains aggregate metrics only.
