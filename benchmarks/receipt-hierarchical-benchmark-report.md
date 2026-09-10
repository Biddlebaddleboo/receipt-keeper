# Hierarchical PP-OCRv6 tiny mixture-of-experts benchmark

The hierarchical path is experimental and is not wired into live receipt extraction. The current production path and fail-open behavior are unchanged.

## Corpus and protocol

SROIE public OCR cache: 500 receipts; grouped tuning/validation/final split 301/100/99. Exact duplicate groups remain together.
Router and specialist parameters were trained on tuning receipts. Configuration selection uses validation only; final is evaluated once after selection.
SROIE exposes vendor/date/total labels. Subtotal/tax/receipt-id/item routing labels are weak OCR/layout labels and are not field-accuracy claims.

## Validation screen

| configuration | first-pass geometry | known precision | known coverage | wrong trusted | mean unresolved | specialist calls/receipt |
|---|---|---:|---:|---:|---:|---:|
| adaptive-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.86 |
| adaptive-wide-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.86 |
| adaptive-tight-min2 | 30% height / 20% overlap / original / band-only / max 1600 | n/a | 0.0% | 0 | 4.99 | 9.86 |
| adaptive-medium-min1 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.86 |
| adaptive-medium-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.86 |
| adaptive-multi3-medium-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 14.79 |
| medium-fixed-min2 | 480 pixels height / 40% overlap / sharpen / whole+band / max 2800 | n/a | 0.0% | 0 | 5.00 | 9.86 |
| adaptive-medium-tuned-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 95.8% | 16.0% | 2 | 4.52 | 9.86 |
| adaptive-wide-tuned-min2 | 50% height / 40% overlap / sharpen / band-only / max 2200 | 100.0% | 1.0% | 0 | 4.97 | 9.86 |
| adaptive-medium-high-gate-min2 | 40% height / 40% overlap / contrast / whole+band / max 2200 | n/a | 0.0% | 0 | 5.00 | 9.86 |
| adaptive-medium-tuned-min3 | 40% height / 40% overlap / contrast / whole+band / max 2200 | 77.8% | 3.0% | 2 | 4.91 | 9.86 |

Selected configuration: **adaptive-wide-tuned-min2**. No final labels were used for selection.

Second-pass screen varied tight/medium/wide/adaptive windows, crop padding, one/two/three independent-support gates, fan-out, and specialist thresholds. The replay screen reuses cached PP-OCRv6 observations; only the selected geometry was rerun through fresh browser OCR.
## Controls and selected pipeline

| path | known precision | known coverage | wrong trusted | mean unresolved | whole-receipt resolved |
|---|---:|---:|---:|---:|---:|
| tesseract-rules | 83.1% | 30.6% | 77 | 3.44 | 0.0% |
| ppocrv6-whole-old-rules | 87.9% | 28.3% | 51 | 3.59 | 0.0% |
| ppocrv6-current-adapted-selector | 97.0% | 8.9% | 4 | 4.41 | 0.0% |
| commit-8a3aac4-band-hybrid | 95.8% | 23.9% | 15 | 3.80 | 0.0% |
| hierarchical validation | n/a | 0.0% | 0 | 5.00 | 0.0% |
| hierarchical untouched final | n/a | 0.0% | 0 | 5.00 | 0.0% |
| hierarchical all 500 | 100.0% | 0.4% | 0 | 4.98 | 0.0% |

| field | trusted | correct | wrong trusted | precision | recall | coverage |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 0 | 0 | 0 | n/a | 0.0% | 0.0% |
| purchase_date | 6 | 6 | 0 | 100.0% | 1.4% | 1.2% |
| subtotal | 0 | 0 | 0 | n/a | n/a | 0.0% |
| tax | 2 | 0 | 0 | n/a | n/a | 0.4% |
| total | 0 | 0 | 0 | n/a | 0.0% | 0.0% |

All-500 whole-receipt local resolution: 0.0%; mean unresolved 4.98; GPT field work 2492.

GPT work comparison (delta versus the named control; positive means reduction, negative means increase): tesseract-rules 1719 (-45.0% reduction), ppocrv6-whole-old-rules 1796 (-38.8% reduction), ppocrv6-current-adapted-selector 2207 (-12.9% reduction), commit-8a3aac4-band-hybrid 1899 (-31.2% reduction). The selected fresh-browser path therefore does not reduce GPT work on this corpus.

## Router precision/recall

| category | precision | recall | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|
| vendor | 76.7% | 24.4% | 198 | 60 | 615 | 624 |
| purchase_date | 96.8% | 45.3% | 362 | 12 | 438 | 685 |
| subtotal | 67.8% | 52.6% | 103 | 49 | 93 | 1252 |
| tax | 100.0% | 97.3% | 1238 | 0 | 35 | 224 |
| total | 93.0% | 75.5% | 767 | 58 | 249 | 423 |
| receipt_id | 90.4% | 6.2% | 66 | 7 | 1001 | 423 |
| item | 87.8% | 4.8% | 65 | 9 | 1292 | 131 |
| other | n/a | 0.0% | 0 | 0 | 7 | 1490 |

These are multi-label one-vs-rest metrics. One band may correctly route multiple categories; this is not a mutually-exclusive confusion matrix.

## Model and specialist screen

| component | validation precision | validation coverage | validation wrong | serialized bytes |
|---|---:|---:|---:|---:|
| router vendor / logistic | 65.3% | 72.7% | 125 | 772 |
| router vendor / stump-forest | 81.0% | 40.4% | 38 | 1701 |
| router vendor / boosted-stumps | 65.2% | 76.0% | 131 | 1437 |
| router purchase_date / logistic | 65.3% | 58.2% | 100 | 780 |
| router purchase_date / stump-forest | 68.6% | 55.4% | 86 | 1761 |
| router purchase_date / boosted-stumps | 67.6% | 56.2% | 90 | 1434 |
| router subtotal / logistic | 65.0% | 24.8% | 43 | 768 |
| router subtotal / stump-forest | 100.0% | 16.2% | 0 | 1761 |
| router subtotal / boosted-stumps | 100.0% | 16.2% | 0 | 1401 |
| router tax / logistic | 80.8% | 100.0% | 95 | 757 |
| router tax / stump-forest | 100.0% | 80.8% | 0 | 1761 |
| router tax / boosted-stumps | 80.8% | 100.0% | 95 | 1401 |
| router total / logistic | 65.2% | 89.9% | 155 | 758 |
| router total / stump-forest | 77.0% | 71.9% | 82 | 1701 |
| router total / boosted-stumps | 65.0% | 90.1% | 156 | 1437 |
| router receipt_id / logistic | 83.6% | 99.8% | 81 | 773 |
| router receipt_id / stump-forest | 83.4% | 100.0% | 82 | 1741 |
| router receipt_id / boosted-stumps | 83.4% | 100.0% | 82 | 1420 |
| router item / logistic | 82.0% | 99.8% | 89 | 749 |
| router item / stump-forest | 81.8% | 100.0% | 90 | 1741 |
| router item / boosted-stumps | 81.8% | 100.0% | 90 | 1401 |
| router other / logistic | 80.0% | 1.0% | 1 | 748 |
| router other / stump-forest | n/a | 0.0% | 0 | 1721 |
| router other / boosted-stumps | 100.0% | 0.6% | 0 | 1428 |
| expert vendor / logistic | 100.0% | 0.2% | 0 | 632 |
| expert purchase_date / logistic | 100.0% | 3.3% | 0 | 656 |
| expert subtotal / logistic | 100.0% | 1.7% | 0 | 534 |
| expert tax / logistic | 100.0% | 1.9% | 0 | 659 |
| expert total / logistic | n/a | 0.0% | 0 | 686 |
| expert receipt_id / logistic | 100.0% | 78.1% | 0 | 595 |
| expert item / logistic | 100.0% | 3.7% | 0 | 608 |

The shipped representation is logistic for all router/specialist categories; stump-forest and boosted-stump router candidates are benchmarked above but are not encoded in the browser bundle because they did not provide a safe validated advantage at their tested size.

## Cost, deduplication, and production

Replay plan: 147.86 first-pass line observations/receipt, 9.86 specialist crops/receipt, 154.35 specialist line observations/receipt. Replay is a selector/router screen over cached PP-OCRv6 observations; it does not claim new OCR quality.
Full selected browser run: {"sampleSize":500,"ocrModelBytes":6318080,"ocrRuntimeBytes":21989346,"firstPassConfig":{"name":"hierarchical-first-pass-adaptive-wide-tuned-min2","bandHeightMode":"fraction","bandHeight":0.5,"overlap":0.4,"preprocessing":"sharpen","maxDimension":2200,"includeWholeImage":false},"initializationMs":6404.100000023842,"firstPassMeanMs":7307.598800002098,"firstPassP95Ms":10003.399999976158,"expertMeanMs":9621.771599999785,"expertP95Ms":14393.300000011921,"totalMeanMs":18592.5773999995,"totalP95Ms":26376.5,"preparationMeanMs":1585.359400000453,"firstPassInvocationsPerReceipt":3,"specialistInvocationsPerReceipt":6,"firstPassLinesPerReceipt":93.168,"expertLinesPerReceipt":122.354,"heapAfterMeanBytes":215013521.432,"heapAfterMaxBytes":279592395}. Hierarchical model JSON: {"routerBytes":6844,"expertBytes":5130,"totalBytes":11974,"routerCategories":8,"expertCategories":7} bytes by serialized component; PP-OCRv6 asset/runtime sizes are included in the browser-cost object. Peak heap is an optional browser metric.
Specialist invocation is category-routed: a total crop is sent only to the total expert, and a crop with no selected category receives no specialist. Overlapping copies are merged before support counts; identical observation keys never count twice.
Read-only GCS status inventory: {"sampleSize":52,"statusOnly":true,"walmartReceipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.980769230769231,"walmart":{"receipts":6,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":0,"total":0},"meanUnresolvedFields":5},"other":{"receipts":46,"fieldCounts":{"vendor":0,"purchase_date":0,"subtotal":0,"tax":1,"total":0},"meanUnresolvedFields":4.978260869565218}}. Production has no independent field labels, so it is not used for precision claims or tuning.

## Decision

No promotion is made. The adaptive path remains experimental: SROIE has only vendor/date/total labels, production receipts have no independent labels, and any trusted-field error is safety-critical. Uncertain fields remain unresolved for GPT. No 99.5% or 99.9% retention claim is made; the fresh-browser path has near-zero trusted coverage and the labeled final split is only 99 receipts.
