# Receipt frontend classical-ML benchmark

Status: the trained model is retained as an offline shadow configuration, but is **not promoted to live trusted extraction**. It did not produce a material safe coverage gain on actual browser OCR, and the only additional trusted shadow values were weakly supervised tax candidates.

## Data and split protocol

- Public corpus: all 500 cached images and OCR/labels from [ICDAR 2019 SROIE](https://github.com/zzzDavid/ICDAR-2019-SROIE). SROIE supplies usable key labels for store, date, and total; it does not provide independent subtotal/tax ground truth.
- Browser benchmark: Tesseract.js was run over all 500 public images with `{ blocks: true }`, preserving line bounding boxes and OCR confidence. One corrupt/tiny image was retained as an explicit OCR abstention rather than removed from the denominator.
- Production benchmark: 52 historical receipt objects cached read-only from the application GCS bucket. The cache and OCR-derived output are ignored and no customer images or OCR text are committed. Production images have no trusted field labels, so their output is coverage/review evidence only.
- Receipt-level splits: 301 tuning, 100 validation, and 99 untouched final records. Duplicate groups `[12, 15, 16, 18]` and `[277, 452]` stay within one split. The model was trained from the tuning split, thresholds were selected on validation, and the final split was not used for tuning.

## Model candidates

Each field has an independent candidate scorer. Features are inexpensive handcrafted values: normalized line position/size, first/last-line indicators, character ratios, amount/date pattern flags, OCR confidence, field keywords on the line and neighboring lines, neighboring amount evidence, and amount position. The exported logistic model has 149 features per field and no runtime ML dependency.

| candidate | vendor validation safe candidates | date validation safe candidates | subtotal/tax supervision | total validation safe candidates |
| --- | ---: | ---: | --- | ---: |
| logistic regression | 3 / 3 | 5 / 5 | weak labels only | 1 / 1 |
| 12-tree depth-two stump forest | 0 | 0 | weak labels only | 0 |

The logistic export was selected for the shadow benchmark because it had the better validation safety/coverage trade-off on the supervised fields. Its confidence is calibrated with validation score bins and must also pass a per-field margin, raw-score, label-evidence, and value-ambiguity gate. No field borrows confidence from another field. Tax is never inferred from subtotal/total arithmetic.

Model artifact: `src/lib/receiptFieldModel.json`, 12,343 bytes minified on disk (11,847 bytes after JSON parsing/serialization). The measured dot-product/feature cost was about 5.6 seconds for 500 boxed SROIE records, or about 11 ms/receipt in the Node benchmark; this excludes Tesseract OCR and is suitable for a browser/mobile shadow pass.

## Actual Tesseract benchmark

The live rules baseline and the selected production path are identical because the ML promotion gate failed. “Precision” and “recall” are reported only for SROIE-labeled store/date/total fields; subtotal and tax are intentionally n/a.

| field | rules trusted | rules precision | rules recall | ML-only trusted | selected live trusted | selected live precision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| store name | 2 | 100.0% | 0.4% | 0 | 2 | 100.0% |
| date | 211 | 89.4% | 41.9% | 0 | 211 | 89.4% |
| subtotal | 89 | n/a | n/a | 0 | 89 | n/a |
| tax | 216 | n/a | n/a | 7* | 216 | n/a |
| total | 246 | 64.5% | 31.7% | 0 | 246 | 64.5% |

\* The seven ML-only tax decisions are not an accuracy result: they come from weak label heuristics and are blocked from the live path. The combined model path returned to the rules counts after the unique-labelled-value guard. Therefore ML changed trusted coverage by 0 fields and estimated GPT field reduction by 0% relative to rules.

Calibration on labeled trusted browser predictions:

| strategy/field | ECE | Brier score | labeled trusted predictions |
| --- | ---: | ---: | ---: |
| rules / date | 0.0558 | 0.0977 | 208 |
| rules / total | 0.3251 | 0.3347 | 245 |
| ML / labeled fields | n/a | n/a | 0 |

The ML model’s exported calibration bins are exercised during offline scoring, but there are no labeled trusted ML predictions in the actual-browser promotion path; reporting an ML accuracy or calibration rate from its unresolved shadow candidates would be misleading.

The held-out 99-receipt browser final slice (not used for model/threshold selection) had the same selected-live rules path: store 1 trusted at 100.0% precision, date 46 at 93.3%, subtotal 10 with no label score, tax 57 with no label score, and total 52 at 63.5% precision. These are descriptive final-set results, not a 99.5% safety claim.

## Production GCS corpus

All 52 cached production receipts were OCR-processed read-only. There is no automatic paper/field ground truth, so no precision claim is made. The live rules path produced:

- 52/52 receipts with at least one unresolved field; GPT fallback remained 100% at receipt level and zero complete no-GPT receipts were observed.
- Trusted field counts: store 1/52, date 12/52, subtotal 12/52, tax 21/52, total 27/52.
- 73/260 field slots were trusted (28.1% estimated field-level GPT work reduction). The ML shadow produced no promotable additional field coverage.
- Production OCR-derived values remain local and ignored. Images were accessed read-only; no bucket object was changed.

## Difficult cases and safety decision

The public set includes low contrast, shadows, skew/perspective, long receipts, repeated totals, multiple amount columns, and OCR failures. The real corpus remains a manual review queue where field truth is unknown. Walmart/footer crop failures are covered by the separate [crop safety report](./receipt-crop-real-report.md); the classical crop detector remains fail-open and unrelated field values never increase crop confidence.

The model’s main failure mode is selection among repeated amount/date candidates after OCR damage. A model that looks good on boxed SROIE OCR can be unsafe on the actual Tesseract layout/confidence distribution. Because the real browser run showed no safe ML coverage gain, live OCR continues to use the validated rules path. The model can be re-evaluated after adding privacy-safe labeled production geometry, without changing the backend’s independent trusted-field validation or partial-GPT behavior.

## Reproduction

```text
python3 scripts/train_receipt_field_model.py
npm run benchmark:receipt-frontend:ml
npm run benchmark:receipt-frontend:browser-ocr
npm run benchmark:receipt-frontend:score
```

The first command trains offline and exports only coefficients. The browser OCR command is the expensive all-500/all-production run; its ignored cache is used by the score command. The frontend review/edit/Reject/Use AI actions and backend unresolved-field prompt behavior are unchanged.

Implementation commit: `7563260` (frontend); backend ML-source validation commit: `3aec861`.
