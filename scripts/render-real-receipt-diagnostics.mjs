import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("benchmarks/real-receipt-manifest.json", "utf8"));
const results = JSON.parse(await readFile("benchmarks/real-receipt-results.json", "utf8"));
const diagnosticsDirectory = "benchmarks/real-receipt-diagnostics";
await mkdir(diagnosticsDirectory, { recursive: true });

const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
}[character]));
const pointList = (corners) => corners
  ? [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft, corners.topLeft]
  : [];
const area = (crop) => crop ? (crop.right - crop.left) * (crop.bottom - crop.top) : 0;

const groups = new Map();
for (const entry of manifest) {
  const groupKey = entry.owner_hash || entry.filename.split("_")[0];
  if (!groups.has(groupKey)) groups.set(groupKey, []);
  groups.get(groupKey).push(entry);
}
const groupOrder = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
const splitByGroup = new Map();
groupOrder.forEach(([groupKey], index) => splitByGroup.set(groupKey, index === 0 ? "tuning" : index === 1 ? "validation" : "final"));

const reviewQueue = [];
const indexRows = [];
for (const [index, entry] of manifest.entries()) {
  const result = results[index];
  const before = result.before || {};
  const selected = result.selected || {};
  const groupKey = entry.owner_hash || entry.filename.split("_")[0];
  const obviousClipping = Boolean(before.crop && before.darkBelowCropRatio > 0.01);
  const reviewReasons = [];
  if (!selected.detection) reviewReasons.push("no-detection");
  if (obviousClipping) reviewReasons.push("known-before-content-clipping");
  if (entry.vendor && /walmart/i.test(entry.vendor)) reviewReasons.push("walmart-footer-review");
  if (before.crop && before.crop.bottom < result.originalHeight) reviewReasons.push("before-bottom-crop");
  if (selected.crop) reviewReasons.push("accepted-crop-needs-paper-boundary-review");
  reviewQueue.push({
    reviewId: `real-${String(index + 1).padStart(3, "0")}`,
    split: splitByGroup.get(groupKey),
    filename: entry.filename,
    receiptId: entry.receipt_id || null,
    vendor: entry.vendor || null,
    originalWidth: result.originalWidth,
    originalHeight: result.originalHeight,
    beforeCrop: before.crop || null,
    beforeMargins: before.margins || null,
    selectedCrop: selected.crop || null,
    selectedProposal: selected.proposedCrop || null,
    selectedMargins: selected.margins || null,
    selectedConfidence: selected.detection?.confidence ?? null,
    estimatedDarkContentBelowBeforeCrop: before.darkBelowCropRatio || 0,
    knownContentClippingBefore: obviousClipping,
    groundTruthStatus: "unknown-manual-paper-boundary-review-required",
    reviewReasons,
  });

  const width = result.originalWidth;
  const height = result.originalHeight;
  const beforePoints = pointList(before.mappedCorners).map((point) => `${point.x},${point.y}`).join(" ");
  const selectedPoints = pointList(selected.mappedCorners).map((point) => `${point.x},${point.y}`).join(" ");
  const text = [
    `id: real-${String(index + 1).padStart(3, "0")}  split: ${splitByGroup.get(groupKey)}`,
    `vendor: ${entry.vendor || "unknown"}`,
    `before crop: ${before.crop ? `${before.crop.left},${before.crop.top} - ${before.crop.right},${before.crop.bottom}` : "none"}`,
    `selected crop: ${selected.crop ? `${selected.crop.left},${selected.crop.top} - ${selected.crop.right},${selected.crop.bottom}` : "none"}`,
    `selected margins: ${selected.margins ? Object.values(selected.margins).map((value) => `${(value * 100).toFixed(1)}%`).join(" / ") : "none"}`,
    `review: ${reviewReasons.join(", ") || "manual boundary review"}`,
  ];
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" xlink:href="../real-receipts/${encodeURIComponent(entry.filename)}"/>
  ${beforePoints ? `<polyline points="${beforePoints}" fill="none" stroke="#ff7a00" stroke-width="8" opacity="0.85"/>` : ""}
  ${selectedPoints ? `<polyline points="${selectedPoints}" fill="none" stroke="#e11d48" stroke-width="6" opacity="0.9"/>` : ""}
  ${before.crop ? `<rect x="${before.crop.left}" y="${before.crop.top}" width="${before.crop.right - before.crop.left}" height="${before.crop.bottom - before.crop.top}" fill="none" stroke="#f97316" stroke-width="6" stroke-dasharray="18 10"/>` : ""}
  ${selected.crop ? `<rect x="${selected.crop.left}" y="${selected.crop.top}" width="${selected.crop.right - selected.crop.left}" height="${selected.crop.bottom - selected.crop.top}" fill="none" stroke="#16a34a" stroke-width="6"/>` : ""}
  <rect x="0" y="0" width="${Math.min(width, 1100)}" height="${text.length * 34 + 24}" fill="#111827" opacity="0.82"/>
  <g fill="white" font-family="monospace" font-size="24">${text.map((line, lineIndex) => `<text x="18" y="${38 + lineIndex * 34}">${escapeXml(line)}</text>`).join("")}</g>
</svg>`;
  const diagnosticName = `${String(index + 1).padStart(3, "0")}-${entry.filename.split("_")[0]}.svg`;
  await writeFile(`${diagnosticsDirectory}/${diagnosticName}`, svg);
  indexRows.push(`<tr><td>${index + 1}</td><td>${escapeXml(entry.vendor || "unknown")}</td><td>${splitByGroup.get(groupKey)}</td><td>${before.crop ? "crop" : "no crop"}</td><td>${selected.crop ? "crop" : "no crop"}</td><td>${obviousClipping ? "KNOWN CLIP" : "review"}</td><td><a href="${diagnosticName}">diagnostic</a></td></tr>`);
}

await writeFile("benchmarks/real-receipt-review-queue.json", JSON.stringify(reviewQueue, null, 2));
await writeFile("benchmarks/real-receipt-splits.json", JSON.stringify({
  method: "whole-owner/group split; largest group tuning, second-largest validation, remaining groups final",
  groups: groupOrder.map(([groupKey, entries]) => ({ groupKey, count: entries.length, split: splitByGroup.get(groupKey) })),
  reviewQueue: reviewQueue.map(({ reviewId, split, filename }) => ({ reviewId, split, filename })),
}, null, 2));
await writeFile(`${diagnosticsDirectory}/index.html`, `<!doctype html><meta charset="utf-8"><title>Receipt crop diagnostics</title><style>body{font:14px system-ui}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px}</style><h1>Real receipt crop diagnostics</h1><p>Orange is the pre-change boundary/crop, red is the selected boundary, green is the accepted post-change crop. All records remain in the manual paper-boundary review queue because no ground-truth boundary is inferred automatically.</p><table><tr><th>#</th><th>Vendor</th><th>Split</th><th>Before</th><th>Selected</th><th>Risk</th><th>View</th></tr>${indexRows.join("")}</table>`);
console.log(`Wrote ${reviewQueue.length} review records and ${indexRows.length} SVG diagnostics to ${diagnosticsDirectory}`);
