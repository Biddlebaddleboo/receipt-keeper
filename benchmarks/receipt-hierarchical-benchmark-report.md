# Hierarchical PP-OCRv6 tiny mixture-of-experts benchmark

The hierarchical path is experimental and is not wired into live receipt extraction. The current production path and fail-open behavior are unchanged.

## Corpus and protocol

SROIE public OCR cache: 500 receipts; grouped tuning/validation/final split 301/100/99. Exact duplicate groups remain together.
Router and specialist parameters were trained on tuning receipts. Configuration selection uses validation only; final is evaluated once after selection.
SROIE exposes vendor/date/total labels. Subtotal/tax/receipt-id/item routing labels are weak OCR/layout labels and are not field-accuracy claims.

## Router calibration diagnosis

Commit 8d routed only the highest-scoring categories from each band using conservative model thresholds and a shared crop budget. In its fresh-browser screen, receipt-ID recall was approximately 6% and vendor recall approximately 24%, so the correct specialist frequently never received a crop; the final trust gate then correctly abstained. The new router thresholds are category-specific and selected for recall on grouped validation (vendor/date/subtotal/tax/total/receipt-ID/item targets 90%/95%/90%/98%/95%/98%/98%).
The router is now a high-recall work allocator: category-specific top-band quotas, top-1/top-2/top-3 per-band fan-out, a broad geometry-only vendor header prior, and round-robin crop budgeting protect weak vendor/receipt-ID/item routes from starvation. Router false positives remain inexpensive specialist rejects and cannot make a field trusted.
The final-total guard was also tightened after replay diagnostics: a standalone GST/tax payable label or a later total label cannot bless an earlier tax amount. Total labels must be on the amount line or immediately above it.

Finance root cause and fix: the previous routed specialist treated every amount in a crop containing a subtotal/tax keyword as an equally valid candidate. GST summaries, discounts, payment/change lines, and total-inclusive text therefore created competing values before agreement. The new finance expert uses amount-to-label association (same-line/above-line order, relative column, amount rank, OCR confidence, and opposing-role labels), trains on weakly labelled explicit financial rows plus routed hard negatives, and keeps only the best role-associated amount per observation. Inclusive-tax/subtotal labels and tax metadata fail open. Amounts attached to an excluded-GST phrase, payment/change text, or an incomplete Amount/Tax column header are also rejected; a directly labelled parseable GST amount remains eligible. Equivalent currency/comma formatting is canonicalized before agreement; repeated overlapping/view copies remain one observation. An explicitly labelled, high-calibration finance prediction may bypass the two-observation requirement only when its own strict field gate and geometry checks pass. The validation-only finance gate screen compared subtotal/tax calibrated thresholds (.60/.65, .58/.58, and .55/.55); .58 for subtotal recovered two explicit subtotal rows, while tax remained at .65 because the lower tax slice admitted a GST-column/header false positive.

## Validation screen

| configuration | first-pass geometry | known precision | known coverage | wrong trusted | mean unresolved | specialist calls/receipt |
|---|---|---:|---:|---:|---:|---:|
| adaptive-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-wide-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-tight-min2 | 30% height / 20% overlap / original / band-only / max 1600 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-medium-min1 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.98 | 7.81 |
| adaptive-medium-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 7.81 |
| adaptive-multi3-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 11.24 |
| medium-fixed-min2 | 480 pixels height / 40% overlap / sharpen / whole+band / max 2800 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-medium-tuned-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-wide-tuned-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-medium-high-gate-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 7.81 |
| adaptive-medium-tuned-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 7.81 |
| high-recall-fanout-top1 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 3.66 |
| high-recall-fanout-top2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 6.74 |
| high-recall-fanout-top3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 1.0% | 0 | 4.97 | 8.90 |
| specialist-calibrated-top3-tight | 40% height / 40% overlap / contrast / whole+band / max 2200 | 96.2% | 8.7% | 1 | 4.74 | 8.90 |
| specialist-calibrated-top3-medium | 40% height / 40% overlap / contrast / whole+band / max 2200 | 97.7% | 14.7% | 1 | 4.56 | 8.90 |
| specialist-calibrated-top3-wide | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 14.7% | 0 | 4.56 | 8.90 |
| specialist-calibrated-top3-medium-multiview | 40% height / 40% overlap / contrast / whole+band / max 2200 | 97.7% | 14.7% | 1 | 4.56 | 8.90 |
| specialist-calibrated-top3-medium-safe-vendor87 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 20.3% | 0 | 4.39 | 8.90 |
| specialist-finance-top3-medium-support2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 16.3% | 0 | 4.49 | 9.38 |
| specialist-finance-top3-wide-support2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 15.7% | 0 | 4.51 | 9.38 |
| specialist-finance-top3-medium-multiview-support2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 16.3% | 0 | 4.49 | 9.38 |
| specialist-finance-high-recall-calibrated-single | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 22.0% | 0 | 4.30 | 11.57 |

Selected configuration: **specialist-finance-high-recall-calibrated-single**. No final labels were used for selection.

Second-pass screen varied tight/medium/wide/adaptive windows, crop padding, one/two/three independent-support gates, fan-out, and specialist thresholds. The replay screen reuses cached PP-OCRv6 observations; no new browser OCR artifact was available for the selected configuration, so fresh-browser rows are not claimed below.
## Controls and selected pipeline

Historical `fec6f03` selected replay (recorded before this iteration): validation had 61 known trusted fields at 0 wrong (20.3% known coverage); the untouched final had 60 known trusted fields with 59 labelled correct at 0 wrong (20.2% known coverage); all 500 had 253 known trusted fields, 242 labelled correct, and 9 wrong (96.4% known precision, 16.9% known coverage). This historical control was not used for selection.

| path | known precision | known coverage | wrong trusted | mean unresolved | whole-receipt resolved |
|---|---:|---:|---:|---:|---:|
| tesseract-rules | 83.1% | 30.6% | 77 | 3.44 | 0.0% |
| ppocrv6-whole-old-rules | 87.9% | 28.3% | 51 | 3.59 | 0.0% |
| ppocrv6-current-adapted-selector | 97.0% | 8.9% | 4 | 4.41 | 0.0% |
| commit-5569ad1-hierarchical | 98.6% | 9.7% | 2 | 4.71 | 0.0% |
| commit-8a3aac4-band-hybrid | 95.8% | 23.9% | 15 | 3.80 | 0.0% |
| commit-8d2e757-hierarchical | 100.0% | 0.4% | 0 | 4.98 | 0.0% |
| fec6f03 baseline (prior selected replay) | 96.4% | 16.9% | 9 | 4.49 | n/a |
| hierarchical replay validation (100) | 100.0% | 22.0% | 0 | 4.30 | 0.0% |
| hierarchical replay untouched final (99) | 100.0% | 21.2% | 0 | 4.20 | 0.0% |
| hierarchical all 500 replay | 96.3% | 18.0% | 10 | 4.34 | 0.0% |

### All-500 replay field results

| field | trusted | correct | wrong trusted | precision | recall | coverage |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 9 | 8 | 1 | 88.9% | 1.6% | 1.8% |
| purchase_date | 133 | 126 | 5 | 96.2% | 28.6% | 26.6% |
| subtotal | 14 | 0 | 0 | n/a | n/a | 2.8% |
| tax | 47 | 0 | 0 | n/a | n/a | 9.4% |
| total | 128 | 124 | 4 | 96.9% | 24.8% | 25.6% |

### Untouched-final field results

| field | trusted | correct | wrong trusted | precision | recall | coverage |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 3 | 3 | 0 | 100.0% | 3.0% | 3.0% |
| purchase_date | 23 | 22 | 0 | 100.0% | 26.5% | 23.2% |
| subtotal | 2 | 0 | 0 | n/a | n/a | 2.0% |
| tax | 14 | 0 | 0 | n/a | n/a | 14.1% |
| total | 37 | 37 | 0 | 100.0% | 37.4% | 37.4% |

All-500 whole-receipt local resolution: 0.0%; mean unresolved 4.34; GPT field work 2169.

GPT work comparison (delta versus the named control; positive means reduction, negative means increase): tesseract-rules 1719 (-26.2% reduction), ppocrv6-whole-old-rules 1796 (-20.8% reduction), ppocrv6-current-adapted-selector 2207 (1.7% reduction), commit-5569ad1-hierarchical 2354 (7.9% reduction), commit-8a3aac4-band-hybrid 1899 (-14.2% reduction). The selected replay reduces unresolved-field work versus 5569 on the cached corpus; no new full browser run is claimed.

## Router precision/recall

| category | precision | recall | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 81.0% | 60.9% | 162 | 38 | 104 | 191 |
| purchase_date | 98.4% | 65.5% | 186 | 3 | 98 | 208 |
| subtotal | 83.3% | 88.2% | 60 | 12 | 8 | 415 |
| tax | 99.0% | 49.5% | 198 | 2 | 202 | 93 |
| total | 91.8% | 57.7% | 179 | 16 | 131 | 169 |
| receipt_id | 100.0% | 70.9% | 293 | 0 | 120 | 82 |
| item | 100.0% | 73.8% | 299 | 0 | 106 | 90 |
| other | n/a | 0.0% | 0 | 0 | 4 | 491 |

These are multi-label one-vs-rest metrics. One band may correctly route multiple categories; this is not a mutually-exclusive confusion matrix.

### Ranked-band recall (top-N)

The top-N figures are category-specific ranked-band recall before the per-band fan-out cap. They show whether the specialist's true region is among the first 1, 2, or 3 router candidates; router precision is intentionally not used as a trust gate.

| category | top-1 recall | top-2 recall | top-3 recall |
|---|---:|---:|---:|
| vendor | 27.8% | 60.9% | 82.3% |
| purchase_date | 33.1% | 67.6% | 95.8% |
| subtotal | 35.3% | 69.1% | 95.6% |
| tax | 24.8% | 49.5% | 74.0% |
| total | 29.7% | 59.4% | 79.7% |
| receipt_id | 24.2% | 48.4% | 71.2% |
| item | 24.7% | 49.4% | 73.8% |
| other | 75.0% | 100.0% | 100.0% |

### Fan-out and category-threshold screen (validation)

Fan-out is the maximum number of categories routed from one band. Each configuration also applies category-specific top-band quotas; the router threshold is recall-first and does not gate final trust.

| configuration | fan-out | vendor R | date R | total R | receipt-ID R | item R | top-1/2/3 mean R |
|---|---:|---:|---:|---:|---:|---:|---:|
| adaptive-medium-min2 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-wide-min2 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-tight-min2 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-min1 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-min3 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-multi3-medium-min2 | 3 | 25.2% | 28.2% | 61.9% | 65.6% | 78.8% | 34.3% / 63.0% / 84.0% |
| medium-fixed-min2 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-tuned-min2 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-wide-tuned-min2 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-high-gate-min2 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-tuned-min3 | 2 | 8.3% | 22.5% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| high-recall-fanout-top1 | 1 | 0.8% | 0.4% | 3.2% | 55.9% | 18.3% | 34.3% / 63.0% / 84.0% |
| high-recall-fanout-top2 | 2 | 10.5% | 28.9% | 22.3% | 65.1% | 54.3% | 34.3% / 63.0% / 84.0% |
| high-recall-fanout-top3 | 3 | 29.3% | 38.0% | 52.9% | 67.8% | 66.7% | 34.3% / 63.0% / 84.0% |
| specialist-calibrated-top3-tight | 3 | 29.3% | 38.0% | 52.9% | 67.8% | 66.7% | 34.3% / 63.0% / 84.0% |
| specialist-calibrated-top3-medium | 3 | 29.3% | 38.0% | 52.9% | 67.8% | 66.7% | 34.3% / 63.0% / 84.0% |
| specialist-calibrated-top3-wide | 3 | 29.3% | 38.0% | 52.9% | 67.8% | 66.7% | 34.3% / 63.0% / 84.0% |
| specialist-calibrated-top3-medium-multiview | 3 | 29.3% | 38.0% | 52.9% | 67.8% | 66.7% | 34.3% / 63.0% / 84.0% |
| specialist-calibrated-top3-medium-safe-vendor87 | 3 | 29.3% | 38.0% | 52.9% | 67.8% | 66.7% | 34.3% / 63.0% / 84.0% |
| specialist-finance-top3-medium-support2 | 3 | 28.2% | 34.9% | 46.5% | 65.6% | 64.0% | 34.3% / 63.0% / 84.0% |
| specialist-finance-top3-wide-support2 | 3 | 28.2% | 34.9% | 46.5% | 65.6% | 64.0% | 34.3% / 63.0% / 84.0% |
| specialist-finance-top3-medium-multiview-support2 | 3 | 28.2% | 34.9% | 46.5% | 65.6% | 64.0% | 34.3% / 63.0% / 84.0% |
| specialist-finance-high-recall-calibrated-single | 7 | 60.9% | 65.5% | 57.7% | 70.9% | 73.8% | 34.3% / 63.0% / 84.0% |

### Per-stage funnel (selected replay validation)

Counts are summed over the 100 grouped validation receipts. The path is router eligibility → routed band/category pair → proposed crop → crop returning OCR lines → candidate value → specialist model pass → independent agreement → final trusted value. A zero at a later stage is an abstention, not a forced guess. Conversion columns expose where agreement and final trust are lost.

| category | eligible | routed | crops | OCR crops | OCR lines | candidates | model pass | agreement | trusted | model→agreement | agreement→trusted |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| vendor | 435 | 200 | 200 | 200 | 833 | 478 | 233 | 2 | 1 | 0.9% | 50.0% |
| purchase_date | 256 | 189 | 189 | 189 | 1535 | 192 | 55 | 30 | 22 | 54.5% | 73.3% |
| subtotal | 73 | 72 | 72 | 72 | 904 | 70 | 62 | 2 | 2 | 3.2% | 100.0% |
| tax | 401 | 200 | 200 | 200 | 2039 | 166 | 77 | 23 | 2 | 29.9% | 8.7% |
| total | 353 | 195 | 195 | 195 | 2057 | 83 | 68 | 49 | 43 | 72.1% | 87.8% |
| receipt_id | 405 | 293 | 293 | 293 | 2239 | 37 | 37 | 30 | 28 | 81.1% | 93.3% |
| item | 396 | 299 | 299 | 299 | 6429 | 1991 | 1991 | 189 | 0 | 9.5% | 0.0% |

Final funnel (untouched final split): {"vendor":{"routerEligibleBands":383,"routedBands":198,"cropsProposed":198,"ocrCrops":198,"ocrLines":1000,"candidateValues":468,"modelPassing":243,"agreementEligible":4,"trusted":3},"purchase_date":{"routerEligibleBands":199,"routedBands":155,"cropsProposed":155,"ocrCrops":155,"ocrLines":1312,"candidateValues":159,"modelPassing":55,"agreementEligible":31,"trusted":23},"subtotal":{"routerEligibleBands":35,"routedBands":34,"cropsProposed":34,"ocrCrops":34,"ocrLines":554,"candidateValues":36,"modelPassing":30,"agreementEligible":4,"trusted":2},"tax":{"routerEligibleBands":383,"routedBands":194,"cropsProposed":194,"ocrCrops":194,"ocrLines":2102,"candidateValues":213,"modelPassing":184,"agreementEligible":63,"trusted":14},"total":{"routerEligibleBands":291,"routedBands":193,"cropsProposed":193,"ocrCrops":193,"ocrLines":2186,"candidateValues":188,"modelPassing":155,"agreementEligible":70,"trusted":37},"receipt_id":{"routerEligibleBands":351,"routedBands":287,"cropsProposed":287,"ocrCrops":287,"ocrLines":2201,"candidateValues":53,"modelPassing":53,"agreementEligible":37,"trusted":35},"item":{"routerEligibleBands":383,"routedBands":296,"cropsProposed":296,"ocrCrops":296,"ocrLines":4132,"candidateValues":1608,"modelPassing":1608,"agreementEligible":95,"trusted":0}}. All-500 funnel when fresh browser output is available: null.
## Model and specialist screen

| component | target recall | route threshold | validation precision | validation coverage | validation wrong | serialized bytes |
|---|---:|---:|---:|---:|---:|---:|
| router vendor / logistic | 0.9 | 0.397 | 55.2% | 87.9% | 195 | 790 |
| router vendor / stump-forest | 0.9 | 0.403 | 53.7% | 100.0% | 229 | 1701 |
| router vendor / boosted-stumps | 0.9 | 0.459 | 68.2% | 71.1% | 112 | 1437 |
| router purchase_date / logistic | 0.95 | 0.607 | 71.2% | 51.9% | 74 | 798 |
| router purchase_date / stump-forest | 0.95 | 0.569 | 70.1% | 55.4% | 82 | 1761 |
| router purchase_date / boosted-stumps | 0.95 | 0.485 | 69.4% | 53.5% | 81 | 1437 |
| router subtotal / logistic | 0.9 | 0.688 | 100.0% | 14.5% | 0 | 782 |
| router subtotal / stump-forest | 0.9 | 0.997 | 100.0% | 16.2% | 0 | 1761 |
| router subtotal / boosted-stumps | 0.9 | 0.800 | 100.0% | 16.2% | 0 | 1401 |
| router tax / logistic | 0.98 | 0.446 | 97.8% | 81.0% | 9 | 777 |
| router tax / stump-forest | 0.98 | 0.990 | 100.0% | 80.8% | 0 | 1761 |
| router tax / boosted-stumps | 0.98 | 0.800 | 100.0% | 80.8% | 0 | 1401 |
| router total / logistic | 0.95 | 0.558 | 78.2% | 71.3% | 77 | 780 |
| router total / stump-forest | 0.95 | 0.150 | 58.6% | 100.0% | 205 | 1701 |
| router total / boosted-stumps | 0.95 | 0.531 | 76.5% | 73.1% | 85 | 1437 |
| router receipt_id / logistic | 0.98 | 0.559 | 100.0% | 81.8% | 0 | 791 |
| router receipt_id / stump-forest | 0.98 | 0.999 | 100.0% | 83.2% | 0 | 1741 |
| router receipt_id / boosted-stumps | 0.98 | 0.608 | 100.0% | 82.0% | 0 | 1420 |
| router item / logistic | 0.98 | 0.604 | 100.0% | 80.2% | 0 | 770 |
| router item / stump-forest | 0.98 | 0.999 | 100.0% | 81.8% | 0 | 1741 |
| router item / boosted-stumps | 0.98 | 0.800 | 100.0% | 81.8% | 0 | 1401 |
| router other / logistic | 0.8 | 0.564 | 62.5% | 1.6% | 3 | 776 |
| router other / stump-forest | 0.8 | 0.008 | 1.2% | 100.0% | 489 | 1721 |
| router other / boosted-stumps | 0.8 | 0.415 | 55.6% | 1.8% | 4 | 1428 |
| expert vendor / logistic | n/a | n/a | n/a | 0.0% | 0 | 728 |
| expert purchase_date / logistic | n/a | n/a | n/a | 0.0% | 0 | 786 |
| expert subtotal / logistic | n/a | n/a | 100.0% | 4.3% | 0 | 782 |
| expert tax / logistic | n/a | n/a | 100.0% | 33.1% | 0 | 833 |
| expert total / logistic | n/a | n/a | n/a | 0.0% | 0 | 738 |
| expert receipt_id / logistic | n/a | n/a | 97.4% | 23.2% | 1 | 774 |
| expert item / logistic | n/a | n/a | 100.0% | 100.0% | 0 | 766 |

The shipped representation is logistic for all router/specialist categories; stump-forest and boosted-stump router candidates are benchmarked above but are not encoded in the browser bundle because they did not provide a safe validated advantage at their tested size.

## Cost, deduplication, and production

Replay plan: 147.86 first-pass line observations/receipt, 14.28 specialist crops/receipt, 145.87 specialist line observations/receipt. Replay is a selector/router screen over cached PP-OCRv6 observations; it does not claim new OCR quality.
Offline benchmark process cost: 502.5s wall time, 1089 MiB peak RSS, 958 MiB heap used at report time. This is the Node replay cost, not a mobile-browser measurement.
Full selected browser run: not cached; replay specialist cost is an upper bound because the browser now early-stops a category after safe trust. Hierarchical model JSON: {"routerBytes":7006,"expertBytes":6092,"totalBytes":13098,"routerCategories":8,"expertCategories":7} bytes by serialized component; PP-OCRv6 asset/runtime sizes are included in the browser-cost object. Peak heap is an optional browser metric.
Specialist invocation is category-routed: a total crop is sent only to the total expert, and a crop with no selected category receives no specialist. Overlapping copies are merged before support counts; identical observation keys never count twice.
Read-only GCS status inventory: {"source":"receipt-hierarchical-production-all-adaptive-wide-tuned-min2.json","sampleSize":52,"statusOnly":true,"walmartReceipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.980769230769231,"walmart":{"receipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":0,"total":0},"meanUnresolvedFields":5},"other":{"receipts":46,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.978260869565218}}. Production has no independent field labels, so it is not used for precision claims or tuning.

## Decision

No promotion is made. The adaptive path remains experimental: SROIE has only vendor/date/total labels, production receipts have no independent labels, and any trusted-field error is safety-critical. Uncertain fields remain unresolved for GPT. No 99.5% or 99.9% retention claim is made; a full selected browser run is not cached and the untouched final split contains only 99 receipts.
