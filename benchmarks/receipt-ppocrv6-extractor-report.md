# PP-OCRv6 adapted receipt field extractor benchmark

The PP-OCRv6 path is experimental. It uses the public SROIE labels and cached PP-OCRv6 line geometry; no receipt image or OCR text is written to this report.

## Method

- Tuning: 301 SROIE IDs (duplicate groups kept together) for logistic coefficients.
- Validation: 100 receipt IDs for model/gate selection; no final IDs used for tuning.
- Final: 99 untouched receipt IDs, evaluated after the configuration was frozen.
- Models compared: independent logistic regressions and tiny stump forests offline; the browser artifact is logistic only.
- Subtotal/tax have no SROIE key labels, so their precision/recall is reported as n/a rather than treated as correct.

## Validation

### Current Tesseract + rules

| field | trusted | precision | recall | trusted coverage | wrong trusted |
|---|---:|---:|---:|---:|---:|
| vendor | 0 | n/a | 0.0% | 0.0% | 0 |
| purchase_date | 49 | 87.8% | 44.3% | 49.0% | 6 |
| subtotal | 21 | 0.0% | n/a | 21.0% | 0 |
| tax | 40 | 0.0% | n/a | 40.0% | 0 |
| total | 30 | 70.0% | 21.0% | 30.0% | 9 |

### PP-OCRv6 + old rules

| field | trusted | precision | recall | trusted coverage | wrong trusted |
|---|---:|---:|---:|---:|---:|
| vendor | 0 | n/a | 0.0% | 0.0% | 0 |
| purchase_date | 35 | 100.0% | 36.1% | 35.0% | 0 |
| subtotal | 21 | 0.0% | n/a | 21.0% | 0 |
| tax | 35 | 0.0% | n/a | 35.0% | 0 |
| total | 30 | 73.3% | 22.0% | 30.0% | 8 |

### PP-OCRv6 + adapted selector

| field | trusted | precision | recall | trusted coverage | wrong trusted |
|---|---:|---:|---:|---:|---:|
| vendor | 6 | 100.0% | 6.0% | 6.0% | 0 |
| purchase_date | 32 | 100.0% | 33.0% | 32.0% | 0 |
| subtotal | 19 | 0.0% | n/a | 19.0% | 0 |
| tax | 10 | 0.0% | n/a | 10.0% | 0 |
| total | 5 | 100.0% | 5.0% | 5.0% | 0 |

Validation trusted field rate: 14.4%; mean unresolved fields: 4.28; selector mean/p95: 9.194/16.816 ms; fixed known-field cases vs old PP-OCRv6 rules: 39; made worse: 53.
Against PP-OCRv6 + old rules, the adapted selector changes unresolved-field work by -12.9% (negative means more GPT work).
The cached PP-OCRv6 OCR pass itself averaged 3315.6 ms (p95 4582.3 ms); the adapted selector excludes OCR from its 9.194 ms mean.

## Untouched final evaluation

### PP-OCRv6 + old rules

| field | trusted | precision | recall | trusted coverage | wrong trusted |
|---|---:|---:|---:|---:|---:|
| vendor | 1 | 100.0% | 1.0% | 1.0% | 0 |
| purchase_date | 45 | 100.0% | 53.6% | 45.5% | 0 |
| subtotal | 8 | 0.0% | n/a | 8.1% | 0 |
| tax | 48 | 0.0% | n/a | 48.5% | 0 |
| total | 59 | 91.5% | 54.5% | 59.6% | 5 |

### PP-OCRv6 + adapted selector

| field | trusted | precision | recall | trusted coverage | wrong trusted |
|---|---:|---:|---:|---:|---:|
| vendor | 0 | n/a | 0.0% | 0.0% | 0 |
| purchase_date | 6 | 100.0% | 7.1% | 6.1% | 0 |
| subtotal | 8 | 0.0% | n/a | 8.1% | 0 |
| tax | 15 | 0.0% | n/a | 15.2% | 0 |
| total | 33 | 100.0% | 33.3% | 33.3% | 0 |

Final trusted field rate: 12.5%; mean unresolved fields: 4.37. This is an empirical result on 99 receipts, not a 99.5%/99.9% statistical guarantee.

## All 500 SROIE receipts

### PP-OCRv6 + old rules

| field | trusted | precision | recall | trusted coverage | wrong trusted |
|---|---:|---:|---:|---:|---:|
| vendor | 1 | 100.0% | 0.2% | 0.2% | 0 |
| purchase_date | 189 | 97.4% | 41.5% | 37.8% | 5 |
| subtotal | 85 | 0.0% | n/a | 17.0% | 0 |
| tax | 195 | 0.0% | n/a | 39.0% | 0 |
| total | 234 | 80.3% | 37.7% | 46.8% | 46 |

### PP-OCRv6 + adapted selector

| field | trusted | precision | recall | trusted coverage | wrong trusted |
|---|---:|---:|---:|---:|---:|
| vendor | 7 | 85.7% | 1.2% | 1.4% | 1 |
| purchase_date | 68 | 97.0% | 14.7% | 13.6% | 2 |
| subtotal | 82 | 0.0% | n/a | 16.4% | 0 |
| tax | 77 | 0.0% | n/a | 15.4% | 0 |
| total | 59 | 98.3% | 11.6% | 11.8% | 1 |

Model artifact: 6087 bytes. The adapter runtime is five scalar logistic dot products; measured validation selector mean/p95 is 9.194/16.816 ms, excluding OCR.

## Offline model comparison

| field | logistic validation precision / coverage | stump-forest validation precision / coverage |
|---|---:|---:|
| vendor | 100.0% / 6.0% | 0.0% / 0.0% |
| purchase_date | 100.0% / 50.7% | 100.0% / 89.6% |
| subtotal | 95.7% / 23.0% | 100.0% / 22.0% |
| tax | 95.8% / 96.0% | 100.0% / 92.0% |
| total | 100.0% / 9.0% | 0.0% / 0.0% |

## Decision

The adapted path remains experimental: validation does not show a material coverage improvement over PP-OCRv6 + old rules, and the adapted path is not a safe drop-in promotion despite eliminating known labeled-field errors on validation. The existing live Tesseract + rules path is unchanged.

## Production metadata replay

Production results are descriptive status counts only: the bucket corpus has no independent field annotations in this repository, and no private values are emitted.

PP-OCRv6 + old rules: {"sampleSize":52,"trustedSlots":79,"trustedFieldCounts":{"vendor":0,"purchase_date":17,"subtotal":13,"tax":28,"total":21},"fallbackReceipts":52,"meanUnresolvedFields":3.480769230769231,"trustedFieldRate":0.3038461538461538,"receiptFallbackRate":1,"ocrRuntimeMs":{"mean":3404.5019230716503}}; PP-OCRv6 + adapted: {"sampleSize":52,"trustedSlots":21,"trustedFieldCounts":{"vendor":0,"purchase_date":8,"subtotal":6,"tax":7,"total":0},"fallbackReceipts":52,"meanUnresolvedFields":4.596153846153846,"trustedFieldRate":0.08076923076923077,"receiptFallbackRate":1,"ocrRuntimeMs":{"mean":3400.301923072109}}; Walmart old/adapted: {"sampleSize":6,"trustedSlots":14,"trustedFieldCounts":{"vendor":0,"purchase_date":1,"subtotal":5,"tax":6,"total":2},"fallbackReceipts":6,"meanUnresolvedFields":2.6666666666666665,"trustedFieldRate":0.4666666666666667,"receiptFallbackRate":1,"ocrRuntimeMs":{"mean":3481.5833333432674}} / {"sampleSize":6,"trustedSlots":1,"trustedFieldCounts":{"vendor":0,"purchase_date":0,"subtotal":1,"tax":0,"total":0},"fallbackReceipts":6,"meanUnresolvedFields":4.833333333333333,"trustedFieldRate":0.03333333333333333,"receiptFallbackRate":1,"ocrRuntimeMs":{"mean":3478.1000000039735}}.
