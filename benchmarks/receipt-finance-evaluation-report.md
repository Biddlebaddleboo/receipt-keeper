# Independently labelled subtotal/tax evaluation

This report uses only the public SROIE image-reviewed finance labels in `receipt-finance-evaluation-labels.json`. The label file is separate from training/configuration selection; no private images or OCR text are committed. The 99 grouped-final rows are IDs 400–499 except known duplicate-group member 452; the 100th row is a separately sourced public SROIE image.

Configuration: **specialist-finance-high-recall-calibrated-single**. Receipts scored: **100** of **100** labelled receipts (the extra public row is optional when its local cache is absent).

The earlier 25-receipt image-reviewed sample reported subtotal 9/11 correct trusted (81.8% verified coverage) and tax 22/24 correct trusted (91.7% verified coverage), with no known wrong-trusted values. Those denominators are not pooled with this expanded set.

The expanded set contains 15 explicit subtotal/net labels, 82 receipts with no unambiguous subtotal, and 3 intentionally ambiguous subtotal cases; tax includes 97 verified charged-tax values, 2 receipts with no printed tax field, and 1 ambiguous case. The review includes GST-inclusive receipts, tax-summary tables, discounts/savings, payment/change lines, zero-tax/no-tax receipts, and conflicting handwritten finance sections.

The 99 cached rows reuse the existing PP-OCRv6 observations; the extra public row was run through the browser OCR path separately. Replay timing below is therefore a cached-selector benchmark, not an end-to-end OCR latency claim.

Only `verified` fields enter precision/coverage. `absent` labels penalize trusted false positives. `ambiguous` labels are excluded from accuracy denominators and trusted predictions on them are reported as unsupported.

| field | verified | absent | ambiguous | trusted | correct | wrong trusted | absent trusted | unsupported ambiguous | precision (95% Wilson) | verified coverage (95% Wilson) | trusted coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| subtotal | 15 | 82 | 3 | 10 | 10 | 0 | 0 | 0 | 100.0% [72.2–100.0%] | 66.7% [41.7–84.8%] | 66.7% |
| tax | 97 | 2 | 1 | 76 | 72 | 3 | 0 | 1 | 96.0% [88.9–98.6%] | 74.2% [64.7–81.9%] | 77.3% |

## Safety exceptions

- subtotal: trusted on absent **none** (false-positive rate 0.0% [0.0–4.5%]); wrong trusted verified IDs **none**; unsupported ambiguous IDs **none** (rate 0.0% [0.0–56.2%]).
- tax: trusted on absent **none** (false-positive rate 0.0% [0.0–65.8%]); wrong trusted verified IDs **415, 436, 453**; unsupported ambiguous IDs **400** (rate 100.0% [20.7–100.0%]).

## Verified-value funnel

Counts are only independently verified expected values. A stage count is the number of receipts where that value survives the stage; absent/ambiguous labels are excluded. `crop` means a routed crop proposal contains the expected amount; `ocr` means the specialist OCR observation contains it. Overlapping copies are deduplicated for agreement.

| field | routed | crop | OCR | candidate | model | agreement | trusted |
|---|---:|---:|---:|---:|---:|---:|---:|
| subtotal | 13 | 13 | 13 | 13 | 13 | 10 | 10 |
| tax | 94 | 94 | 91 | 91 | 78 | 76 | 72 |

Verified-value loss IDs by stage (public SROIE IDs; this is geometry/metrics only, not receipt content):
- subtotal: routed: 414, 421; crop: 414, 421; ocr: 414, 421; candidate: 414, 421; model: 414, 421; agreement: 408, 414, 421, 426, 464; trusted: 408, 414, 421, 426, 464
- tax: routed: 415, 420, 421; crop: 415, 420, 421; ocr: 415, 420, 421, 436, 453, 464; candidate: 415, 420, 421, 436, 453, 464; model: 401, 403, 406, 415, 420, 421, 436, 441, 442, 443, 444, 445, 446, 447, 448, 450, 451, 453, 464; agreement: 401, 403, 406, 407, 412, 415, 420, 421, 436, 441, 442, 443, 446, 447, 448, 451, 453, 462, 464, 465, 466; trusted: 401, 403, 406, 407, 412, 415, 420, 421, 436, 441, 442, 443, 444, 445, 446, 447, 448, 450, 451, 453, 457, 462, 464, 465, 466

Mean unresolved fields: 3.49; cached-input baseline (99 comparable rows): 3.98; reduction: 0.49 (12.3%). Model-passing candidates: 2313; agreement-eligible groups: 335; specialist calls: 13.73/receipt; expert input lines: 142.5/receipt; benchmark wall time: 5.5s.

First-stage loss IDs for verified values (the first missing stage is the primary loss category):

- subtotal: routed=414,421; agreement=408,426,464
- tax: routed=415,420,421; ocr=436,453,464; model=401,403,406,441,442,443,444,445,446,447,448,450,451; agreement=407,412,462,465,466; trusted=457

Failure diagnosis from the frozen run: subtotal values reached the model but were lost at agreement on IDs 408, 426, and 464; tax values were lost at routing on 415, 420, and 421, at specialist OCR on 436, 453, and 464, at model gating on 401, 403, 406, 441–448, 450, and 451, and at agreement on 407, 412, 462, 465, and 466. The three wrong-trusted tax cases were 415 (summary base/amount-column association), 436 (concatenated low-quality GST amount), and 453 (inclusive-total line mis-associated as tax). These are receipt IDs and failure categories only; no OCR text is stored.

Decision: the frozen expanded result does not justify promoting or aggressively retuning this configuration: tax has three wrong-trusted verified values (96.0% observed precision), and the Wilson interval is broad. No production detector or trust threshold was changed after this evaluation; any future fix must use a separate tuning subset.

This is a held-out finance evaluation, not a training metric. It is intentionally not used to lower trust thresholds.
