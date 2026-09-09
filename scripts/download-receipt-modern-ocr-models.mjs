import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const modelDir = path.join(root, "benchmarks", "modern-ocr-models");
const files = [
  [
    "PP-OCRv5_mobile_det_onnx_infer.tar",
    "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar",
  ],
  [
    "PP-OCRv5_mobile_rec_onnx_infer.tar",
    "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_onnx_infer.tar",
  ],
  [
    "PP-OCRv6_tiny_det_onnx_infer.tar",
    "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_det_onnx_infer.tar",
  ],
  [
    "PP-OCRv6_tiny_rec_onnx_infer.tar",
    "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_rec_onnx_infer.tar",
  ],
  ["ch_PP-OCRv4_det_infer.onnx", "https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/ch_PP-OCRv4_det_infer.onnx"],
  ["ch_PP-OCRv4_rec_infer.onnx", "https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/ch_PP-OCRv4_rec_infer.onnx"],
  ["ch_ppocr_mobile_v2.0_cls_infer.onnx", "https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/ch_ppocr_mobile_v2.0_cls_infer.onnx"],
  ["ppocr_keys_v1.txt", "https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/ppocr_keys_v1.txt"],
];

await mkdir(modelDir, { recursive: true });
for (const [name, url] of files) {
  const destination = path.join(modelDir, name);
  try {
    const existing = await stat(destination);
    if (existing.size > 0) {
      console.log(`cached ${name} (${existing.size} bytes)`);
      continue;
    }
  } catch {
    // Fetch missing cache entries.
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
  console.log(`downloaded ${name} (${bytes.byteLength} bytes)`);
}
