# Hierarchical PP-OCRv6 tiny mixture-of-experts benchmark

The hierarchical path is experimental and is not wired into live receipt extraction. The current production path and fail-open behavior are unchanged.

## Corpus and protocol

SROIE public OCR cache: 500 receipts; grouped tuning/validation/final split 301/100/99. Exact duplicate groups remain together.
Router and specialist parameters were trained on tuning receipts. Configuration selection uses validation only; final is evaluated once after selection.
The grouped SROIE labels expose vendor/date/total ground truth. Subtotal/tax/receipt-ID/item labels used by the router/trainer remain weak OCR/layout supervision and are not field-accuracy claims. A separate 25-receipt public SROIE final subset was independently image-reviewed for subtotal/tax; its held-out results are reported in `benchmarks/receipt-finance-evaluation-report.md` and were not used for training or configuration selection.

## Router calibration diagnosis

Commit 8d routed only the highest-scoring categories from each band using conservative model thresholds and a shared crop budget. In its fresh-browser screen, receipt-ID recall was approximately 6% and vendor recall approximately 24%, so the correct specialist frequently never received a crop; the final trust gate then correctly abstained. The new router thresholds are category-specific and selected for recall on grouped validation (vendor/date/subtotal/tax/total/receipt-ID/item targets 90%/95%/90%/98%/95%/98%/98%).
The router is now a high-recall work allocator: category-specific top-band quotas, top-1/top-2/top-3 per-band fan-out, a broad geometry-only vendor header prior, and round-robin crop budgeting protect weak vendor/receipt-ID/item routes from starvation. Router false positives remain inexpensive specialist rejects and cannot make a field trusted.
The final-total guard was also tightened after replay diagnostics: a standalone GST/tax payable label or a later total label cannot bless an earlier tax amount. Total labels must be on the amount line or immediately above it.

Finance root cause and fix: the previous routed specialist treated every amount in a crop containing a subtotal/tax keyword as an equally valid candidate. GST summaries, discounts, payment/change lines, and total-inclusive text therefore created competing values before agreement. The new finance expert uses amount-to-label association (same-line/above-line order, relative column, amount rank, OCR confidence, and opposing-role labels), trains on weakly labelled explicit financial rows plus routed hard negatives, and keeps only the best role-associated amount per observation. Inclusive-tax/subtotal labels and tax metadata fail open. Amounts attached to an excluded-GST phrase, payment/change text, or an incomplete Amount/Tax column header are also rejected; a directly labelled parseable GST amount remains eligible. Equivalent currency/comma formatting is canonicalized before agreement; repeated overlapping/view copies remain one observation. An explicitly labelled, high-calibration finance prediction may bypass the two-observation requirement only when its own strict field gate and geometry checks pass. The validation-only finance gate screen compared subtotal/tax calibrated thresholds (.60/.65, .58/.58, and .55/.55); .58 for subtotal recovered two explicit subtotal rows, while tax remained at .65 because the lower tax slice admitted a GST-column/header false positive.

## Validation screen

| configuration | first-pass geometry | known precision | known coverage | wrong trusted | mean unresolved | specialist calls/receipt |
|---|---|---:|---:|---:|---:|---:|
| adaptive-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 7.80 |
| adaptive-wide-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | n/a | 0.0% | 0 | 5.00 | 7.80 |
| adaptive-tight-min2 | 30% height / 20% overlap / original / band-only / max 1600 | n/a | 0.0% | 0 | 5.00 | 7.80 |
| adaptive-medium-min1 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.97 | 7.80 |
| adaptive-medium-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 7.80 |
| adaptive-multi3-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 11.25 |
| medium-fixed-min2 | 480 pixels height / 40% overlap / sharpen / whole+band / max 2800 | n/a | 0.0% | 0 | 5.00 | 7.80 |
| adaptive-medium-tuned-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.93 | 7.80 |
| adaptive-wide-tuned-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | n/a | 0.0% | 0 | 4.93 | 7.80 |
| adaptive-medium-high-gate-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.80 |
| adaptive-medium-tuned-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 7.80 |
| high-recall-fanout-top1 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 3.66 |
| high-recall-fanout-top2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 0.3% | 0 | 4.99 | 6.74 |
| high-recall-fanout-top3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 1.0% | 0 | 4.96 | 8.92 |
| specialist-calibrated-top3-tight | 40% height / 40% overlap / contrast / whole+band / max 2200 | 96.2% | 8.7% | 1 | 4.74 | 8.92 |
| specialist-calibrated-top3-medium | 40% height / 40% overlap / contrast / whole+band / max 2200 | 97.7% | 14.7% | 1 | 4.55 | 8.92 |
| specialist-calibrated-top3-wide | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 14.7% | 0 | 4.55 | 8.92 |
| specialist-calibrated-top3-medium-multiview | 40% height / 40% overlap / contrast / whole+band / max 2200 | 97.7% | 14.7% | 1 | 4.55 | 8.92 |
| specialist-calibrated-top3-medium-safe-vendor87 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 20.3% | 0 | 4.38 | 8.92 |
| specialist-finance-top3-medium-support2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 16.3% | 0 | 4.49 | 9.38 |
| specialist-finance-top3-wide-support2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 15.3% | 0 | 4.50 | 9.38 |
| specialist-finance-top3-medium-multiview-support2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 16.3% | 0 | 4.49 | 9.38 |
| specialist-finance-high-recall-calibrated-single | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 22.0% | 0 | 3.61 | 11.61 |

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
| hierarchical replay validation (100) | 100.0% | 22.0% | 0 | 3.61 | 0.0% |
| hierarchical replay untouched final (99) | 100.0% | 21.2% | 0 | 3.49 | 0.0% |
| hierarchical all 500 replay | 96.3% | 17.9% | 10 | 3.67 | 0.0% |

### All-500 replay field results

| field | trusted | correct | wrong trusted | precision | recall | coverage |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 9 | 8 | 1 | 88.9% | 1.6% | 1.8% |
| purchase_date | 133 | 126 | 5 | 96.2% | 28.6% | 26.6% |
| subtotal | 111 | 0 | 0 | n/a | n/a | 22.2% |
| tax | 286 | 0 | 0 | n/a | n/a | 57.2% |
| total | 127 | 123 | 4 | 96.9% | 24.6% | 25.4% |

### Untouched-final field results

| field | trusted | correct | wrong trusted | precision | recall | coverage |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 3 | 3 | 0 | 100.0% | 3.0% | 3.0% |
| purchase_date | 23 | 22 | 0 | 100.0% | 26.5% | 23.2% |
| subtotal | 10 | 0 | 0 | n/a | n/a | 10.1% |
| tax | 76 | 0 | 0 | n/a | n/a | 76.8% |
| total | 37 | 37 | 0 | 100.0% | 37.4% | 37.4% |

All-500 whole-receipt local resolution: 0.0%; mean unresolved 3.67; GPT field work 1834.

GPT work comparison (delta versus the named control; positive means reduction, negative means increase): tesseract-rules 1719 (-6.7% reduction), ppocrv6-whole-old-rules 1796 (-2.1% reduction), ppocrv6-current-adapted-selector 2207 (16.9% reduction), commit-5569ad1-hierarchical 2354 (22.1% reduction), commit-8a3aac4-band-hybrid 1899 (3.4% reduction). The selected replay reduces unresolved-field work versus 5569 on the cached corpus; no new full browser run is claimed.

## Router precision/recall

| category | precision | recall | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 81.0% | 60.9% | 162 | 38 | 104 | 191 |
| purchase_date | 98.4% | 65.8% | 187 | 3 | 97 | 208 |
| subtotal | 83.3% | 88.2% | 60 | 12 | 8 | 415 |
| tax | 99.0% | 49.5% | 198 | 2 | 202 | 93 |
| total | 91.8% | 58.1% | 180 | 16 | 130 | 169 |
| receipt_id | 100.0% | 70.9% | 293 | 0 | 120 | 82 |
| item | 99.7% | 73.8% | 299 | 1 | 106 | 89 |
| other | n/a | 0.0% | 0 | 0 | 4 | 491 |

These are multi-label one-vs-rest metrics. One band may correctly route multiple categories; this is not a mutually-exclusive confusion matrix.

### Ranked-band recall (top-N)

The top-N figures are category-specific ranked-band recall before the per-band fan-out cap. They show whether the specialist's true region is among the first 1, 2, or 3 router candidates; router precision is intentionally not used as a trust gate.

| category | top-1 recall | top-2 recall | top-3 recall |
|---|---:|---:|---:|
| vendor | 27.8% | 60.9% | 82.3% |
| purchase_date | 33.8% | 67.6% | 95.8% |
| subtotal | 35.3% | 69.1% | 95.6% |
| tax | 24.8% | 49.5% | 74.0% |
| total | 29.7% | 59.4% | 80.0% |
| receipt_id | 24.2% | 48.4% | 71.2% |
| item | 24.7% | 49.4% | 73.8% |
| other | 75.0% | 100.0% | 100.0% |

### Fan-out and category-threshold screen (validation)

Fan-out is the maximum number of categories routed from one band. Each configuration also applies category-specific top-band quotas; the router threshold is recall-first and does not gate final trust.

| configuration | fan-out | vendor R | date R | total R | receipt-ID R | item R | top-1/2/3 mean R |
|---|---:|---:|---:|---:|---:|---:|---:|
| adaptive-medium-min2 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| adaptive-wide-min2 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| adaptive-tight-min2 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| adaptive-medium-min1 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| adaptive-medium-min3 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| adaptive-multi3-medium-min2 | 3 | 25.2% | 28.2% | 63.5% | 65.4% | 79.0% | 34.4% / 63.0% / 84.1% |
| medium-fixed-min2 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| adaptive-medium-tuned-min2 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| adaptive-wide-tuned-min2 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| adaptive-medium-high-gate-min2 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| adaptive-medium-tuned-min3 | 2 | 9.0% | 22.9% | 12.6% | 57.4% | 46.9% | 34.4% / 63.0% / 84.1% |
| high-recall-fanout-top1 | 1 | 0.8% | 0.4% | 5.2% | 54.0% | 19.3% | 34.4% / 63.0% / 84.1% |
| high-recall-fanout-top2 | 2 | 10.5% | 28.9% | 22.6% | 63.4% | 56.5% | 34.4% / 63.0% / 84.1% |
| high-recall-fanout-top3 | 3 | 29.3% | 38.0% | 54.5% | 67.1% | 67.4% | 34.4% / 63.0% / 84.1% |
| specialist-calibrated-top3-tight | 3 | 29.3% | 38.0% | 54.5% | 67.1% | 67.4% | 34.4% / 63.0% / 84.1% |
| specialist-calibrated-top3-medium | 3 | 29.3% | 38.0% | 54.5% | 67.1% | 67.4% | 34.4% / 63.0% / 84.1% |
| specialist-calibrated-top3-wide | 3 | 29.3% | 38.0% | 54.5% | 67.1% | 67.4% | 34.4% / 63.0% / 84.1% |
| specialist-calibrated-top3-medium-multiview | 3 | 29.3% | 38.0% | 54.5% | 67.1% | 67.4% | 34.4% / 63.0% / 84.1% |
| specialist-calibrated-top3-medium-safe-vendor87 | 3 | 29.3% | 38.0% | 54.5% | 67.1% | 67.4% | 34.4% / 63.0% / 84.1% |
| specialist-finance-top3-medium-support2 | 3 | 28.2% | 34.9% | 48.1% | 65.6% | 63.7% | 34.4% / 63.0% / 84.1% |
| specialist-finance-top3-wide-support2 | 3 | 28.2% | 34.9% | 48.1% | 65.6% | 63.7% | 34.4% / 63.0% / 84.1% |
| specialist-finance-top3-medium-multiview-support2 | 3 | 28.2% | 34.9% | 48.1% | 65.6% | 63.7% | 34.4% / 63.0% / 84.1% |
| specialist-finance-high-recall-calibrated-single | 7 | 60.9% | 65.8% | 58.1% | 70.9% | 73.8% | 34.4% / 63.0% / 84.1% |

### Per-stage funnel (selected replay validation)

Counts are summed over the 100 grouped validation receipts. The path is router eligibility → routed band/category pair → proposed crop → crop returning OCR lines → candidate value → specialist model pass → independent agreement → final trusted value. A zero at a later stage is an abstention, not a forced guess. Conversion columns expose where agreement and final trust are lost.

| category | eligible | routed | crops | OCR crops | OCR lines | candidates | model pass | agreement | trusted | model→agreement | agreement→trusted |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| vendor | 435 | 200 | 200 | 200 | 833 | 478 | 233 | 2 | 1 | 0.9% | 50.0% |
| purchase_date | 257 | 190 | 190 | 190 | 1541 | 193 | 55 | 30 | 22 | 54.5% | 73.3% |
| subtotal | 73 | 72 | 72 | 72 | 1060 | 70 | 66 | 24 | 23 | 36.4% | 95.8% |
| tax | 404 | 200 | 200 | 200 | 2690 | 101 | 101 | 71 | 50 | 70.3% | 70.4% |
| total | 359 | 196 | 196 | 196 | 2075 | 83 | 68 | 49 | 43 | 72.1% | 87.8% |
| receipt_id | 406 | 293 | 293 | 293 | 2239 | 37 | 37 | 30 | 28 | 81.1% | 93.3% |
| item | 398 | 300 | 300 | 300 | 6435 | 1992 | 1992 | 190 | 0 | 9.5% | 0.0% |

Final funnel (untouched final split): {"vendor":{"routerEligibleBands":378,"routedBands":198,"cropsProposed":198,"ocrCrops":198,"ocrLines":1000,"candidateValues":468,"modelPassing":243,"agreementEligible":4,"trusted":3},"purchase_date":{"routerEligibleBands":199,"routedBands":155,"cropsProposed":155,"ocrCrops":155,"ocrLines":1315,"candidateValues":159,"modelPassing":55,"agreementEligible":31,"trusted":23},"subtotal":{"routerEligibleBands":38,"routedBands":37,"cropsProposed":37,"ocrCrops":37,"ocrLines":720,"candidateValues":38,"modelPassing":33,"agreementEligible":12,"trusted":10},"tax":{"routerEligibleBands":379,"routedBands":194,"cropsProposed":194,"ocrCrops":194,"ocrLines":2582,"candidateValues":144,"modelPassing":144,"agreementEligible":81,"trusted":76},"total":{"routerEligibleBands":296,"routedBands":193,"cropsProposed":193,"ocrCrops":193,"ocrLines":2186,"candidateValues":188,"modelPassing":155,"agreementEligible":70,"trusted":37},"receipt_id":{"routerEligibleBands":351,"routedBands":287,"cropsProposed":287,"ocrCrops":287,"ocrLines":2201,"candidateValues":53,"modelPassing":53,"agreementEligible":37,"trusted":35},"item":{"routerEligibleBands":379,"routedBands":296,"cropsProposed":296,"ocrCrops":296,"ocrLines":4132,"candidateValues":1608,"modelPassing":1608,"agreementEligible":95,"trusted":0}}. All-500 funnel when fresh browser output is available: null.
## Model and specialist screen

| component | target recall | route threshold | validation precision | validation coverage | validation wrong | serialized bytes |
|---|---:|---:|---:|---:|---:|---:|
| router vendor / logistic | 0.9 | 0.400 | 55.2% | 87.9% | 195 | 797 |
| router vendor / stump-forest | 0.9 | 0.403 | 53.7% | 100.0% | 229 | 1701 |
| router vendor / boosted-stumps | 0.9 | 0.450 | 68.2% | 71.1% | 112 | 1440 |
| router purchase_date / logistic | 0.95 | 0.605 | 70.9% | 52.1% | 75 | 802 |
| router purchase_date / stump-forest | 0.95 | 0.569 | 70.1% | 55.4% | 82 | 1761 |
| router purchase_date / boosted-stumps | 0.95 | 0.485 | 69.4% | 53.5% | 81 | 1437 |
| router subtotal / logistic | 0.9 | 0.684 | 100.0% | 14.7% | 0 | 790 |
| router subtotal / stump-forest | 0.9 | 0.970 | 100.0% | 16.2% | 0 | 1741 |
| router subtotal / boosted-stumps | 0.9 | 0.562 | 100.0% | 14.5% | 0 | 1430 |
| router tax / logistic | 0.98 | 0.410 | 97.0% | 81.6% | 12 | 774 |
| router tax / stump-forest | 0.98 | 0.100 | 80.8% | 100.0% | 95 | 1721 |
| router tax / boosted-stumps | 0.98 | 0.517 | 100.0% | 79.2% | 0 | 1430 |
| router total / logistic | 0.95 | 0.522 | 76.9% | 72.7% | 83 | 780 |
| router total / stump-forest | 0.95 | 0.150 | 58.6% | 100.0% | 205 | 1701 |
| router total / boosted-stumps | 0.95 | 0.518 | 76.2% | 73.1% | 86 | 1435 |
| router receipt_id / logistic | 0.98 | 0.556 | 100.0% | 81.8% | 0 | 786 |
| router receipt_id / stump-forest | 0.98 | 0.999 | 100.0% | 83.2% | 0 | 1741 |
| router receipt_id / boosted-stumps | 0.98 | 0.608 | 100.0% | 82.6% | 0 | 1424 |
| router item / logistic | 0.98 | 0.605 | 99.5% | 80.6% | 2 | 775 |
| router item / stump-forest | 0.98 | 0.999 | 100.0% | 81.8% | 0 | 1741 |
| router item / boosted-stumps | 0.98 | 0.800 | 100.0% | 81.8% | 0 | 1401 |
| router other / logistic | 0.8 | 0.576 | 62.5% | 1.6% | 3 | 776 |
| router other / stump-forest | 0.8 | 0.008 | 1.2% | 100.0% | 489 | 1721 |
| router other / boosted-stumps | 0.8 | 0.400 | 50.0% | 2.0% | 5 | 1432 |
| expert vendor / logistic | n/a | n/a | n/a | 0.0% | 0 | 728 |
| expert purchase_date / logistic | n/a | n/a | n/a | 0.0% | 0 | 786 |
| expert subtotal / logistic | n/a | n/a | 100.0% | 2.2% | 0 | 803 |
| expert tax / logistic | n/a | n/a | 100.0% | 0.5% | 0 | 871 |
| expert total / logistic | n/a | n/a | n/a | 0.0% | 0 | 738 |
| expert receipt_id / logistic | n/a | n/a | 97.4% | 23.2% | 1 | 774 |
| expert item / logistic | n/a | n/a | 100.0% | 100.0% | 0 | 766 |

The shipped representation is logistic for all router/specialist categories; stump-forest and boosted-stump router candidates are benchmarked above but are not encoded in the browser bundle because they did not provide a safe validated advantage at their tested size.

## Cost, deduplication, and production

Replay plan: 147.86 first-pass line observations/receipt, 14.33 specialist crops/receipt, 153.83 specialist line observations/receipt. Replay is a selector/router screen over cached PP-OCRv6 observations; it does not claim new OCR quality.
Offline benchmark process cost: 529.8s wall time, 1109 MiB peak RSS, 976 MiB heap used at report time. This is the Node replay cost, not a mobile-browser measurement.
Full selected browser run: not cached; replay specialist cost is an upper bound because the browser now early-stops a category after safe trust. Hierarchical model JSON: {"routerBytes":7022,"expertBytes":6160,"totalBytes":13182,"routerCategories":8,"expertCategories":7} bytes by serialized component; PP-OCRv6 asset/runtime sizes are included in the browser-cost object. Peak heap is an optional browser metric.
Specialist invocation is category-routed: a total crop is sent only to the total expert, and a crop with no selected category receives no specialist. Overlapping copies are merged before support counts; identical observation keys never count twice.
Read-only GCS status inventory: {"source":"receipt-hierarchical-production-all-adaptive-wide-tuned-min2.json","sampleSize":52,"statusOnly":true,"walmartReceipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.980769230769231,"walmart":{"receipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":0,"total":0},"meanUnresolvedFields":5},"other":{"receipts":46,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.978260869565218}}. Production has no independent field labels, so it is not used for precision claims or tuning.

## Decision

No promotion is made. The adaptive path remains experimental: on the separate independently reviewed finance subset it trusted 9/11 verified subtotals and 22/24 verified taxes at 100% precision with zero wrong-trusted labels, but the sample is small and two finance values still abstain. Production receipts have no independent field labels, so they cannot support accuracy claims. Uncertain fields remain unresolved for GPT. No 99.5% or 99.9% retention claim is made; a full selected browser run is not cached and the untouched grouped final split contains only 99 receipts.
