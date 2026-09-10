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
| adaptive-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.68 |
| adaptive-wide-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.68 |
| adaptive-tight-min2 | 30% height / 20% overlap / original / band-only / max 1600 | n/a | 0.0% | 0 | 4.99 | 9.68 |
| adaptive-medium-min1 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.68 |
| adaptive-medium-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.68 |
| adaptive-multi3-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 13.93 |
| medium-fixed-min2 | 480 pixels height / 40% overlap / sharpen / whole+band / max 2800 | n/a | 0.0% | 0 | 5.00 | 9.68 |
| adaptive-medium-tuned-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 0.7% | 0 | 4.98 | 9.68 |
| adaptive-wide-tuned-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | 100.0% | 0.7% | 0 | 4.98 | 9.68 |
| adaptive-medium-high-gate-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.68 |
| adaptive-medium-tuned-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.68 |
| high-recall-fanout-top1 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 4.57 |
| high-recall-fanout-top2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 1.0% | 0 | 4.97 | 8.39 |
| high-recall-fanout-top3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 100.0% | 9.0% | 0 | 4.73 | 11.02 |

Selected configuration: **high-recall-fanout-top3**. No final labels were used for selection.

Second-pass screen varied tight/medium/wide/adaptive windows, crop padding, one/two/three independent-support gates, fan-out, and specialist thresholds. The replay screen reuses cached PP-OCRv6 observations; only the selected geometry was rerun through fresh browser OCR.
## Controls and selected pipeline

| path | known precision | known coverage | wrong trusted | mean unresolved | whole-receipt resolved |
|---|---:|---:|---:|---:|---:|
| tesseract-rules | 83.1% | 30.6% | 77 | 3.44 | 0.0% |
| ppocrv6-whole-old-rules | 87.9% | 28.3% | 51 | 3.59 | 0.0% |
| ppocrv6-current-adapted-selector | 97.0% | 8.9% | 4 | 4.41 | 0.0% |
| commit-8a3aac4-band-hybrid | 95.8% | 23.9% | 15 | 3.80 | 0.0% |
| commit-8d2e757-hierarchical | 100.0% | 0.4% | 0 | 4.98 | 0.0% |
| hierarchical fresh validation (100) | 100.0% | 3.0% | 0 | 4.91 | 0.0% |
| hierarchical fresh untouched final (99) | 100.0% | 10.4% | 0 | 4.69 | 0.0% |
| hierarchical all 500 replay | 98.6% | 9.7% | 2 | 4.71 | 0.0% |

### All-500 replay field results

| field | trusted | correct | wrong trusted | precision | recall | coverage |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 0 | 0 | 0 | n/a | 0.0% | 0.0% |
| purchase_date | 84 | 84 | 0 | 100.0% | 19.0% | 16.8% |
| subtotal | 1 | 0 | 0 | n/a | n/a | 0.2% |
| tax | 0 | 0 | 0 | n/a | n/a | 0.0% |
| total | 61 | 58 | 2 | 96.7% | 11.6% | 12.2% |

### Fresh untouched-final field results

| field | trusted | correct | wrong trusted | precision | recall | coverage |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 0 | 0 | 0 | n/a | 0.0% | 0.0% |
| purchase_date | 3 | 3 | 0 | 100.0% | 3.6% | 3.0% |
| subtotal | 0 | 0 | 0 | n/a | n/a | 0.0% |
| tax | 0 | 0 | 0 | n/a | n/a | 0.0% |
| total | 28 | 28 | 0 | 100.0% | 28.3% | 28.3% |

All-500 whole-receipt local resolution: 0.0%; mean unresolved 4.71; GPT field work 2354.

GPT work comparison (delta versus the named control; positive means reduction, negative means increase): tesseract-rules 1719 (-36.9% reduction), ppocrv6-whole-old-rules 1796 (-31.1% reduction), ppocrv6-current-adapted-selector 2207 (-6.7% reduction), commit-8a3aac4-band-hybrid 1899 (-24.0% reduction). The selected fresh-browser path therefore does not reduce GPT work on this corpus.

## Router precision/recall

| category | precision | recall | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 75.0% | 50.3% | 174 | 58 | 172 | 372 |
| purchase_date | 97.4% | 43.7% | 150 | 4 | 193 | 429 |
| subtotal | 84.1% | 90.6% | 58 | 11 | 6 | 701 |
| tax | 100.0% | 33.3% | 196 | 0 | 393 | 187 |
| total | 89.7% | 66.4% | 288 | 33 | 146 | 309 |
| receipt_id | 100.0% | 77.2% | 439 | 0 | 130 | 207 |
| item | 99.8% | 83.8% | 533 | 1 | 103 | 139 |
| other | n/a | 0.0% | 0 | 0 | 11 | 765 |

These are multi-label one-vs-rest metrics. One band may correctly route multiple categories; this is not a mutually-exclusive confusion matrix.

### Ranked-band recall (top-N)

The top-N figures are category-specific ranked-band recall before the per-band fan-out cap. They show whether the specialist's true region is among the first 1, 2, or 3 router candidates; router precision is intentionally not used as a trust gate.

| category | top-1 recall | top-2 recall | top-3 recall |
|---|---:|---:|---:|
| vendor | 47.4% | 73.1% | 88.4% |
| purchase_date | 50.7% | 93.6% | 97.1% |
| subtotal | 54.7% | 95.3% | 100.0% |
| tax | 33.3% | 66.2% | 93.7% |
| total | 41.7% | 75.8% | 99.1% |
| receipt_id | 34.8% | 67.5% | 88.8% |
| item | 31.3% | 62.4% | 91.0% |
| other | 81.8% | 100.0% | 100.0% |

### Fan-out and category-threshold screen (validation)

Fan-out is the maximum number of categories routed from one band. Each configuration also applies category-specific top-band quotas; the router threshold is recall-first and does not gate final trust.

| configuration | fan-out | vendor R | date R | total R | receipt-ID R | item R | top-1/2/3 mean R |
|---|---:|---:|---:|---:|---:|---:|---:|
| adaptive-medium-min2 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-wide-min2 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-tight-min2 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-min1 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-min3 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-multi3-medium-min2 | 3 | 25.2% | 27.8% | 61.9% | 65.6% | 78.8% | 34.3% / 63.0% / 84.0% |
| medium-fixed-min2 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-tuned-min2 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-wide-tuned-min2 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-high-gate-min2 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| adaptive-medium-tuned-min3 | 2 | 8.3% | 21.8% | 10.3% | 59.8% | 43.2% | 34.3% / 63.0% / 84.0% |
| high-recall-fanout-top1 | 1 | 0.8% | 0.0% | 3.2% | 55.9% | 18.3% | 34.3% / 63.0% / 84.0% |
| high-recall-fanout-top2 | 2 | 10.2% | 28.9% | 22.3% | 65.1% | 54.3% | 34.3% / 63.0% / 84.0% |
| high-recall-fanout-top3 | 3 | 29.3% | 38.0% | 52.9% | 67.8% | 66.7% | 34.3% / 63.0% / 84.0% |

### Per-stage funnel (selected replay validation)

Counts are summed over the 100 grouped validation receipts. The path is router eligibility → routed band/category pair → proposed crop → crop returning OCR lines → candidate value → specialist model pass → independent agreement → final trusted value. A zero at a later stage is an abstention, not a forced guess.

| category | eligible | routed | crops | OCR crops | OCR lines | candidates | model pass | agreement | trusted |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| vendor | 342 | 110 | 110 | 110 | 655 | 416 | 123 | 4 | 0 |
| purchase_date | 165 | 93 | 93 | 93 | 1055 | 68 | 53 | 6 | 5 |
| subtotal | 49 | 48 | 48 | 48 | 753 | 57 | 1 | 0 | 0 |
| tax | 309 | 99 | 99 | 99 | 1064 | 179 | 22 | 0 | 0 |
| total | 259 | 156 | 156 | 156 | 3444 | 1046 | 235 | 51 | 4 |
| receipt_id | 297 | 224 | 224 | 224 | 1764 | 100 | 100 | 18 | 8 |
| item | 299 | 263 | 263 | 263 | 6045 | 1866 | 171 | 49 | 0 |

Final funnel (untouched final split): {"vendor":{"routerEligibleBands":300,"routedBands":121,"cropsProposed":121,"ocrCrops":121,"ocrLines":903,"candidateValues":546,"modelPassing":199,"agreementEligible":13,"trusted":0},"purchase_date":{"routerEligibleBands":120,"routedBands":66,"cropsProposed":66,"ocrCrops":66,"ocrLines":851,"candidateValues":40,"modelPassing":27,"agreementEligible":3,"trusted":3},"subtotal":{"routerEligibleBands":22,"routedBands":21,"cropsProposed":21,"ocrCrops":21,"ocrLines":381,"candidateValues":26,"modelPassing":0,"agreementEligible":0,"trusted":0},"tax":{"routerEligibleBands":301,"routedBands":97,"cropsProposed":97,"ocrCrops":97,"ocrLines":1153,"candidateValues":142,"modelPassing":28,"agreementEligible":0,"trusted":0},"total":{"routerEligibleBands":196,"routedBands":167,"cropsProposed":167,"ocrCrops":167,"ocrLines":2939,"candidateValues":1130,"modelPassing":304,"agreementEligible":74,"trusted":28},"receipt_id":{"routerEligibleBands":253,"routedBands":214,"cropsProposed":214,"ocrCrops":214,"ocrLines":1867,"candidateValues":186,"modelPassing":186,"agreementEligible":26,"trusted":7},"item":{"routerEligibleBands":290,"routedBands":272,"cropsProposed":272,"ocrCrops":272,"ocrLines":4573,"candidateValues":1787,"modelPassing":237,"agreementEligible":73,"trusted":0}}. All-500 funnel when fresh browser output is available: {"vendor":{"routerEligibleBands":642,"routedBands":231,"cropsProposed":231,"ocrCrops":231,"ocrLines":1558,"candidateValues":962,"modelPassing":322,"agreementEligible":17,"trusted":0},"purchase_date":{"routerEligibleBands":285,"routedBands":159,"cropsProposed":159,"ocrCrops":159,"ocrLines":1906,"candidateValues":108,"modelPassing":80,"agreementEligible":9,"trusted":8},"subtotal":{"routerEligibleBands":71,"routedBands":69,"cropsProposed":69,"ocrCrops":69,"ocrLines":1134,"candidateValues":83,"modelPassing":1,"agreementEligible":0,"trusted":0},"tax":{"routerEligibleBands":610,"routedBands":196,"cropsProposed":196,"ocrCrops":196,"ocrLines":2217,"candidateValues":321,"modelPassing":50,"agreementEligible":0,"trusted":0},"total":{"routerEligibleBands":455,"routedBands":323,"cropsProposed":323,"ocrCrops":323,"ocrLines":6383,"candidateValues":2176,"modelPassing":539,"agreementEligible":125,"trusted":32},"receipt_id":{"routerEligibleBands":550,"routedBands":438,"cropsProposed":438,"ocrCrops":438,"ocrLines":3631,"candidateValues":286,"modelPassing":286,"agreementEligible":44,"trusted":15},"item":{"routerEligibleBands":589,"routedBands":535,"cropsProposed":535,"ocrCrops":535,"ocrLines":10618,"candidateValues":3653,"modelPassing":408,"agreementEligible":122,"trusted":0}}.
## Model and specialist screen

| component | target recall | route threshold | validation precision | validation coverage | validation wrong | serialized bytes |
|---|---:|---:|---:|---:|---:|---:|
| router vendor / logistic | 0.9 | 0.397 | 55.2% | 87.9% | 195 | 790 |
| router vendor / stump-forest | 0.9 | 0.403 | 53.7% | 100.0% | 229 | 1701 |
| router vendor / boosted-stumps | 0.9 | 0.459 | 68.2% | 71.1% | 112 | 1437 |
| router purchase_date / logistic | 0.95 | 0.607 | 70.5% | 51.3% | 75 | 801 |
| router purchase_date / stump-forest | 0.95 | 0.547 | 68.6% | 55.4% | 86 | 1761 |
| router purchase_date / boosted-stumps | 0.95 | 0.481 | 68.6% | 55.4% | 86 | 1434 |
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
| expert vendor / logistic | n/a | n/a | 100.0% | 0.4% | 0 | 606 |
| expert purchase_date / logistic | n/a | n/a | 100.0% | 13.6% | 0 | 656 |
| expert subtotal / logistic | n/a | n/a | 100.0% | 1.7% | 0 | 575 |
| expert tax / logistic | n/a | n/a | 100.0% | 2.1% | 0 | 619 |
| expert total / logistic | n/a | n/a | 100.0% | 0.1% | 0 | 696 |
| expert receipt_id / logistic | n/a | n/a | 99.7% | 68.3% | 1 | 685 |
| expert item / logistic | n/a | n/a | 100.0% | 5.7% | 0 | 677 |

The shipped representation is logistic for all router/specialist categories; stump-forest and boosted-stump router candidates are benchmarked above but are not encoded in the browser bundle because they did not provide a safe validated advantage at their tested size.

## Cost, deduplication, and production

Replay plan: 147.86 first-pass line observations/receipt, 11.02 specialist crops/receipt, 123.34 specialist line observations/receipt. Replay is a selector/router screen over cached PP-OCRv6 observations; it does not claim new OCR quality.
Full selected browser run: {"sampleSize":199,"ocrModelBytes":6318080,"ocrRuntimeBytes":21989346,"firstPassConfig":{"name":"hierarchical-first-pass-high-recall-fanout-top3","bandHeightMode":"fraction","bandHeight":0.4,"overlap":0.4,"preprocessing":"contrast","maxDimension":2200,"includeWholeImage":false},"initializationMs":3621.7999999998137,"firstPassMeanMs":7073.977889447241,"firstPassP95Ms":9576.600000000559,"expertMeanMs":9546.82663316582,"expertP95Ms":12976.399999999907,"totalMeanMs":18124.463819095483,"totalP95Ms":25367.200000000186,"preparationMeanMs":1423.990954773896,"firstPassInvocationsPerReceipt":4,"specialistInvocationsPerReceipt":9.804020100502512,"totalOcrInvocationsPerReceipt":13.804020100502512,"firstPassLinesPerReceipt":94.34673366834171,"expertLinesPerReceipt":137.9246231155779,"heapAfterMeanBytes":205466107.46733668,"heapAfterMaxBytes":251692628}. Hierarchical model JSON: {"routerBytes":7008,"expertBytes":5294,"totalBytes":12302,"routerCategories":8,"expertCategories":7} bytes by serialized component; PP-OCRv6 asset/runtime sizes are included in the browser-cost object. Peak heap is an optional browser metric.
Specialist invocation is category-routed: a total crop is sent only to the total expert, and a crop with no selected category receives no specialist. Overlapping copies are merged before support counts; identical observation keys never count twice.
Read-only GCS status inventory: {"source":"receipt-hierarchical-production-all-adaptive-wide-tuned-min2.json","sampleSize":52,"statusOnly":true,"walmartReceipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.980769230769231,"walmart":{"receipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":0,"total":0},"meanUnresolvedFields":5},"other":{"receipts":46,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.978260869565218}}. Production has no independent field labels, so it is not used for precision claims or tuning.

## Decision

No promotion is made. The adaptive path remains experimental: SROIE has only vendor/date/total labels, production receipts have no independent labels, and any trusted-field error is safety-critical. Uncertain fields remain unresolved for GPT. No 99.5% or 99.9% retention claim is made; fresh-browser coverage remains low and the untouched final split contains only 99 receipts.
