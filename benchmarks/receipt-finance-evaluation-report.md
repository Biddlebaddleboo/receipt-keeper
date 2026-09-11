# Independently labelled subtotal/tax evaluation

This report uses only the public SROIE image-reviewed finance labels in `receipt-finance-evaluation-labels.json`. The label file is separate from training/configuration selection; no private images or OCR text are committed.

Configuration: **specialist-finance-high-recall-calibrated-single**. Receipts scored: **25**.

Only `verified` fields enter precision/coverage. `absent` labels penalize trusted false positives. `ambiguous` labels are excluded from accuracy denominators and trusted predictions on them are reported as unsupported.

| field | verified | absent | ambiguous | trusted | correct | wrong trusted | unsupported ambiguous | precision | verified coverage | trusted coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| subtotal | 11 | 13 | 1 | 9 | 9 | 0 | 0 | 100.0% | 81.8% | 81.8% |
| tax | 24 | 0 | 1 | 23 | 22 | 0 | 1 | 100.0% | 91.7% | 91.7% |

## Verified-value funnel

Counts are only independently verified expected values. A stage count is the number of receipts where that value survives the stage; absent/ambiguous labels are excluded. `crop` means a routed crop proposal contains the expected amount; `ocr` means the specialist OCR observation contains it. Overlapping copies are deduplicated for agreement.

| field | routed | crop | OCR | candidate | model | agreement | trusted |
|---|---:|---:|---:|---:|---:|---:|---:|
| subtotal | 11 | 11 | 11 | 11 | 11 | 9 | 9 |
| tax | 24 | 24 | 23 | 23 | 22 | 22 | 22 |

Verified-value loss IDs by stage (public SROIE IDs; this is geometry/metrics only, not receipt content):
- subtotal: routed: none; crop: none; ocr: none; candidate: none; model: none; agreement: 408, 464; trusted: 408, 464
- tax: routed: none; crop: none; ocr: 464; candidate: 464; model: 401, 464; agreement: 401, 464; trusted: 401, 464

Mean unresolved fields: 3.20. Model-passing candidates: 610; agreement-eligible groups: 87; specialist calls: 14.80/receipt; expert input lines: 164.5/receipt; benchmark wall time: 1.6s.

This is a held-out finance evaluation, not a training metric. It is intentionally not used to lower trust thresholds.
