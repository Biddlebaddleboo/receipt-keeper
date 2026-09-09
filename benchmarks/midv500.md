# MIDV-500 benchmark adapter

MIDV-500 is the public domain/licensed-source mobile identity-document dataset described by [Arlazarov et al.](https://arxiv.org/abs/1807.05786). It contains 500 clips, 50 document types, about 15,000 frames, and a JSON quadrilateral for each frame. It is a document-domain stress check rather than a receipt-only dataset; SROIE is receipt-focused but does not provide a reliable outer-receipt boundary for this task.

The official distribution is large and is intentionally not checked into this repository. To prepare benchmark-ready, downsampled grayscale records:

```bash
python3 scripts/prepare-midv500.py /path/to/smartengines.com/midv-500/dataset benchmarks/midv500-records.jsonl
MIDV500_RECORDS=benchmarks/midv500-records.jsonl npm run benchmark:receipt-crop
```

The adapter keeps the image pixels and scales the annotated quadrilateral together. It splits by document clip/type group before tuning so adjacent video frames cannot cross from tuning into validation or final test. If the dataset is unavailable, the checked-in deterministic stress corpus still exercises the detector and its required failure modes offline.

The dataset is available from the official distribution at `ftp://smartengines.com/midv-500/`; the paper documents the per-frame boundary annotations and the source-image licensing basis.
