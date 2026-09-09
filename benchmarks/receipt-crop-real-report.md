# Real production receipt auto-crop report

Generated from a read-only cache of 52 objects in `gs://ai-receipt-tracker/receipts/**`. Customer images and diagnostic SVGs remain local and ignored; this report contains only aggregate and derived geometry. The benchmark runner is `scripts/real-receipt-browser.html`, and `node scripts/render-real-receipt-diagnostics.mjs` creates the local review queue and overlays.

## Evaluation protocol

- The corpus contains 52 unique cached objects (18.7 MB), with two large owner groups and eight unlinked single-image groups. Exact object duplicates were not observed. Groups were kept intact: 24 images tuning, 20 validation, and 8 final. The final slice was evaluated once after the safety configuration was locked.
- The real images do not contain paper-boundary ground truth. Therefore full-receipt retention, IoU, false-crop rate, and catastrophic clipping are not reported as statistically measured ground-truth metrics. Every image is in `benchmarks/real-receipt-review-queue.json` with `groundTruthStatus: unknown-manual-paper-boundary-review-required`.
- “Known clipping” means obvious visible receipt content below the proposed crop, confirmed from the source image/diagnostic. Dark-pixel checks are safety signals, not paper-boundary ground truth.
- The pre-change column reproduces the shipped adaptive detector and its 6% per-side guard. The selected column uses the same classical detector plus the conservative safety changes below.

## Before and after

| metric | shipped production | selected configuration |
| --- | ---: | ---: |
| images | 52 | 52 |
| crop rate (accepted crops) | 7 / 52 (13.5%) | 2 / 52 (3.8%) |
| no-crop rate | 45 / 52 (86.5%) | 50 / 52 (96.2%) |
| candidate proposals | 7 | 3 |
| estimated full-receipt retention | not determinable automatically | 2 / 2 accepted crops had no obvious clipping; statistical estimate unavailable |
| known content-clipping failures | 5 | 0 |
| catastrophic clipping failures | 5 known cases | 0 known cases |
| known false-crop rate | 5 / 7 accepted crops (71.4%) | 0 / 2 accepted crops (0% known; manual boundary review still required) |
| mean background removed, accepted crops | 40.6% | 54.6% |
| mean background removed, all images | 5.5% | 2.1% |
| bottom-edge crops | 5 | 0 |

The safety constraint dominates this corpus: the detector now crops fewer images and preserves the original when evidence is ambiguous. It does not support a 99.5% or 99.9% retention claim; there are only two accepted crops and no automatic paper-boundary labels.

## Walmart and bottom-edge findings

Six metadata-linked Walmart receipts were identified. The shipped detector accepted one lower-fragment crop (`real-026`), which would remove nearly the whole receipt above the detected fragment. The other five Walmart records failed open. A separate visually Walmart-like object without matching receipt metadata (`real-032`) was also a known bottom/footer failure before the change. Its lower barcode/date-time/footer region was below the proposed crop.

The five obvious shipped failures were:

`real-003` and `real-008` (long Circle K thermal receipts), `real-019` (long receipt with low-contrast footer), `real-024` (long Pioneer receipt), and `real-032` (Walmart-like receipt with bottom date/time/barcode). `real-026` is the lower-component failure described above. These are retained as derived, non-image regressions in `benchmarks/receipt-crop-real-regressions.json`.

Examples fixed: `real-003`, `real-008`, `real-019`, `real-024`, `real-026`, and `real-032` are all no longer accepted as the unsafe pre-change crop. Examples made worse: none were identified in the locked post-change review; the trade-off is six additional fail-open/no-crop outcomes and therefore less automatic background removal.

## Root cause

The detector treated the strongest bright connected component as the receipt boundary. Thermal-paper shadows, faint printing, and whitespace between receipt sections broke that component before the physical paper ended. On long receipts, the score then preferred a compact component with plausible corners. The 4% padding was insufficient, and the old 6% bottom guard allowed a proposed bottom edge well above the actual paper/footer.

## Algorithm changes

- Added a 15% asymmetric bottom safety guard. The top and horizontal side guards remain at 6%; a near-frame bottom keeps the original image edge.
- Reject a small component beginning in the lower portion of the frame instead of treating it as a complete receipt. This specifically prevents the Walmart lower-fragment failure without a vendor-specific rule.
- Added a cheap bottom-content safety scan over the analysis image. If dark receipt-like content remains below a proposed crop, the runtime returns the original file.
- Kept the existing threshold diversity, morphology, geometric gates, confidence gates, classical connected-component scoring, and fail-open behavior. No neural or learned model was added.

## Review artifacts and remaining risks

Run `node scripts/render-real-receipt-diagnostics.mjs` after the browser benchmark to create 52 local SVG overlays. Orange marks the pre-change boundary/crop, red the selected boundary, and green the accepted crop. The 52-item queue is deliberately manual because the physical paper boundary cannot be inferred reliably from the current metadata.

The two accepted crops (`real-018` and `real-032`) still require human paper-boundary review. Remaining difficult cases include white paper on white backgrounds, receipts touching the frame, glare/shadows that resemble paper edges, and crops where only a partial receipt is visible. Those cases fail open when they do not pass the conservative gates.

## Reproduction

The local corpus is obtained read-only with the documented GCS commands in the benchmark workflow, then served by Vite so the exact browser-compatible detector runs at the 800-pixel analysis limit. Run the normal Vitest suite and the synthetic benchmark in addition to the real-corpus browser runner.
