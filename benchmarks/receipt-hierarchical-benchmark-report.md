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

## Validation screen

| configuration | first-pass geometry | known precision | known coverage | wrong trusted | mean unresolved | specialist calls/receipt |
|---|---|---:|---:|---:|---:|---:|
| adaptive-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-wide-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-tight-min2 | 30% height / 20% overlap / original / band-only / max 1600 | n/a | 0.0% | 0 | 5.00 | 7.81 |
| adaptive-medium-min1 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.88 | 7.81 |
| adaptive-medium-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 7.81 |
| adaptive-multi3-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.99 | 11.24 |
| medium-fixed-min2 | 480 pixels height / 40% overlap / sharpen / whole+band / max 2800 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-medium-tuned-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-wide-tuned-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-medium-high-gate-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 4.99 | 7.81 |
| adaptive-medium-tuned-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 7.81 |
| high-recall-fanout-top1 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 3.66 |
| high-recall-fanout-top2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 6.74 |
| high-recall-fanout-top3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 1.0% | 0 | 4.97 | 8.90 |
| specialist-calibrated-top3-tight | 40% height / 40% overlap / contrast / whole+band / max 2200 | 96.2% | 8.7% | 1 | 4.74 | 8.90 |
| specialist-calibrated-top3-medium | 40% height / 40% overlap / contrast / whole+band / max 2200 | 97.7% | 14.7% | 1 | 4.56 | 8.90 |
| specialist-calibrated-top3-wide | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 14.7% | 0 | 4.56 | 8.90 |
| specialist-calibrated-top3-medium-multiview | 40% height / 40% overlap / contrast / whole+band / max 2200 | 97.7% | 14.7% | 1 | 4.56 | 8.90 |
| specialist-calibrated-top3-medium-safe-vendor87 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 20.3% | 0 | 4.39 | 8.90 |

Selected configuration: **specialist-calibrated-top3-medium-safe-vendor87**. No final labels were used for selection.

Second-pass screen varied tight/medium/wide/adaptive windows, crop padding, one/two/three independent-support gates, fan-out, and specialist thresholds. The replay screen reuses cached PP-OCRv6 observations; no new browser OCR artifact was available for the selected configuration, so fresh-browser rows are not claimed below.
## Controls and selected pipeline

| path | known precision | known coverage | wrong trusted | mean unresolved | whole-receipt resolved |
|---|---:|---:|---:|---:|---:|
| tesseract-rules | 83.1% | 30.6% | 77 | 3.44 | 0.0% |
| ppocrv6-whole-old-rules | 87.9% | 28.3% | 51 | 3.59 | 0.0% |
| ppocrv6-current-adapted-selector | 97.0% | 8.9% | 4 | 4.41 | 0.0% |
| commit-5569ad1-hierarchical | 98.6% | 9.7% | 2 | 4.71 | 0.0% |
| commit-8a3aac4-band-hybrid | 95.8% | 23.9% | 15 | 3.80 | 0.0% |
| commit-8d2e757-hierarchical | 100.0% | 0.4% | 0 | 4.98 | 0.0% |
| hierarchical replay validation (100) | 100.0% | 20.3% | 0 | 4.39 | 0.0% |
| hierarchical replay untouched final (99) | 100.0% | 20.2% | 0 | 4.39 | 0.0% |
| hierarchical all 500 replay | 96.4% | 16.9% | 9 | 4.49 | 0.0% |

### All-500 replay field results

| field | trusted | correct | wrong trusted | precision | recall | coverage |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 7 | 6 | 1 | 85.7% | 1.2% | 1.4% |
| purchase_date | 120 | 114 | 4 | 96.6% | 25.9% | 24.0% |
| subtotal | 1 | 0 | 0 | n/a | n/a | 0.2% |
| tax | 0 | 0 | 0 | n/a | n/a | 0.0% |
| total | 126 | 122 | 4 | 96.8% | 24.4% | 25.2% |

### Untouched-final field results

| field | trusted | correct | wrong trusted | precision | recall | coverage |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 3 | 3 | 0 | 100.0% | 3.0% | 3.0% |
| purchase_date | 21 | 20 | 0 | 100.0% | 24.1% | 21.2% |
| subtotal | 0 | 0 | 0 | n/a | n/a | 0.0% |
| tax | 0 | 0 | 0 | n/a | n/a | 0.0% |
| total | 36 | 36 | 0 | 100.0% | 36.4% | 36.4% |

All-500 whole-receipt local resolution: 0.0%; mean unresolved 4.49; GPT field work 2246.

GPT work comparison (delta versus the named control; positive means reduction, negative means increase): tesseract-rules 1719 (-30.7% reduction), ppocrv6-whole-old-rules 1796 (-25.1% reduction), ppocrv6-current-adapted-selector 2207 (-1.8% reduction), commit-5569ad1-hierarchical 2354 (4.6% reduction), commit-8a3aac4-band-hybrid 1899 (-18.3% reduction). The selected replay reduces unresolved-field work versus 5569 on the cached corpus; no new full browser run is claimed.

## Router precision/recall

| category | precision | recall | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 74.3% | 29.3% | 78 | 27 | 188 | 202 |
| purchase_date | 97.3% | 38.0% | 108 | 3 | 176 | 208 |
| subtotal | 84.9% | 66.2% | 45 | 8 | 23 | 419 |
| tax | 100.0% | 24.8% | 99 | 0 | 301 | 95 |
| total | 94.8% | 52.9% | 164 | 9 | 146 | 176 |
| receipt_id | 100.0% | 67.8% | 280 | 0 | 133 | 82 |
| item | 100.0% | 66.7% | 270 | 0 | 135 | 90 |
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

### Per-stage funnel (selected replay validation)

Counts are summed over the 100 grouped validation receipts. The path is router eligibility → routed band/category pair → proposed crop → crop returning OCR lines → candidate value → specialist model pass → independent agreement → final trusted value. A zero at a later stage is an abstention, not a forced guess.

| category | eligible | routed | crops | OCR crops | OCR lines | candidates | model pass | agreement | trusted |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| vendor | 435 | 105 | 105 | 105 | 422 | 244 | 114 | 1 | 1 |
| purchase_date | 256 | 111 | 111 | 111 | 828 | 113 | 35 | 25 | 17 |
| subtotal | 73 | 53 | 53 | 53 | 678 | 94 | 91 | 1 | 0 |
| tax | 401 | 99 | 99 | 99 | 1046 | 177 | 174 | 0 | 0 |
| total | 353 | 173 | 173 | 173 | 1774 | 81 | 67 | 49 | 43 |
| receipt_id | 405 | 280 | 280 | 280 | 2030 | 33 | 33 | 27 | 25 |
| item | 396 | 270 | 270 | 270 | 5903 | 1768 | 1768 | 163 | 0 |

Final funnel (untouched final split): {"vendor":{"routerEligibleBands":383,"routedBands":107,"cropsProposed":107,"ocrCrops":107,"ocrLines":521,"candidateValues":248,"modelPassing":129,"agreementEligible":4,"trusted":3},"purchase_date":{"routerEligibleBands":199,"routedBands":119,"cropsProposed":119,"ocrCrops":119,"ocrLines":934,"candidateValues":122,"modelPassing":39,"agreementEligible":29,"trusted":21},"subtotal":{"routerEligibleBands":35,"routedBands":26,"cropsProposed":26,"ocrCrops":26,"ocrLines":435,"candidateValues":50,"modelPassing":50,"agreementEligible":0,"trusted":0},"tax":{"routerEligibleBands":383,"routedBands":97,"cropsProposed":97,"ocrCrops":97,"ocrLines":1078,"candidateValues":178,"modelPassing":176,"agreementEligible":0,"trusted":0},"total":{"routerEligibleBands":291,"routedBands":164,"cropsProposed":164,"ocrCrops":164,"ocrLines":1889,"candidateValues":167,"modelPassing":134,"agreementEligible":69,"trusted":36},"receipt_id":{"routerEligibleBands":351,"routedBands":267,"cropsProposed":267,"ocrCrops":267,"ocrLines":1917,"candidateValues":53,"modelPassing":53,"agreementEligible":37,"trusted":35},"item":{"routerEligibleBands":383,"routedBands":278,"cropsProposed":278,"ocrCrops":278,"ocrLines":3772,"candidateValues":1471,"modelPassing":1471,"agreementEligible":76,"trusted":0}}. All-500 funnel when fresh browser output is available: null.
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
| expert vendor / logistic | n/a | n/a | n/a | 0.0% | 0 | 704 |
| expert purchase_date / logistic | n/a | n/a | n/a | 0.0% | 0 | 762 |
| expert subtotal / logistic | n/a | n/a | 100.0% | 100.0% | 0 | 673 |
| expert tax / logistic | n/a | n/a | 100.0% | 100.0% | 0 | 730 |
| expert total / logistic | n/a | n/a | n/a | 0.0% | 0 | 714 |
| expert receipt_id / logistic | n/a | n/a | 100.0% | 33.3% | 0 | 750 |
| expert item / logistic | n/a | n/a | 100.0% | 100.0% | 0 | 742 |

The shipped representation is logistic for all router/specialist categories; stump-forest and boosted-stump router candidates are benchmarked above but are not encoded in the browser bundle because they did not provide a safe validated advantage at their tested size.

## Cost, deduplication, and production

Replay plan: 147.86 first-pass line observations/receipt, 11.01 specialist crops/receipt, 114.58 specialist line observations/receipt. Replay is a selector/router screen over cached PP-OCRv6 observations; it does not claim new OCR quality.
Full selected browser run: not cached; replay specialist cost is an upper bound because the browser now early-stops a category after safe trust. Hierarchical model JSON: {"routerBytes":7006,"expertBytes":5829,"totalBytes":12835,"routerCategories":8,"expertCategories":7} bytes by serialized component; PP-OCRv6 asset/runtime sizes are included in the browser-cost object. Peak heap is an optional browser metric.
Specialist invocation is category-routed: a total crop is sent only to the total expert, and a crop with no selected category receives no specialist. Overlapping copies are merged before support counts; identical observation keys never count twice.
Read-only GCS status inventory: {"source":"receipt-hierarchical-production-all-adaptive-wide-tuned-min2.json","sampleSize":52,"statusOnly":true,"walmartReceipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.980769230769231,"walmart":{"receipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":0,"total":0},"meanUnresolvedFields":5},"other":{"receipts":46,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.978260869565218}}. Production has no independent field labels, so it is not used for precision claims or tuning.

## Decision

No promotion is made. The adaptive path remains experimental: SROIE has only vendor/date/total labels, production receipts have no independent labels, and any trusted-field error is safety-critical. Uncertain fields remain unresolved for GPT. No 99.5% or 99.9% retention claim is made; a full selected browser run is not cached and the untouched final split contains only 99 receipts.
