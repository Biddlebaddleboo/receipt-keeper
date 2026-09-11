import { describe, expect, it } from "vitest";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyReceiptBands, buildAdaptiveExpertCrops, extractReceiptFieldsFromHierarchicalBands, hierarchicalModelInfo, RECEIPT_HIERARCHICAL_SCREENING_CONFIGS, type ReceiptHierarchicalConfig, type ReceiptHierarchicalExtraction, type ReceiptHierarchicalObservation, type ReceiptRouterBandInput } from "@/lib/receiptHierarchicalBandOcr";
import { RECEIPT_BAND_SCREENING_CONFIGS } from "@/lib/receiptBandOcr";
import type { ReceiptFrontendField, ReceiptFrontendFields } from "@/lib/receiptFrontendExtractor";
import type { ReceiptOcrLine } from "@/lib/receiptOcr";

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "benchmarks/receipt-band-ocr-sroie-all-fraction40-overlap40-contrast-2200-rules-hybrid.json");
const tesseractPath = path.join(root, "benchmarks/receipt-frontend-ocr-sroie-all-baseline.json");
const ppocrPath = path.join(root, "benchmarks/receipt-modern-ocr-sroie-all-v6.json");
const modelComparisonPath = path.join(root, "benchmarks/receipt-hierarchical-model-comparison.json");
const fields: readonly ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];
const knownFields: readonly ReceiptFrontendField[] = ["vendor", "purchase_date", "total"];
const categories = ["vendor", "purchase_date", "subtotal", "tax", "total", "receipt_id", "item", "other"] as const;
const duplicateGroup = new Map([[12, 12], [15, 12], [16, 12], [18, 12], [277, 277], [452, 277]]);
const splitFor = (id: string): "tuning" | "validation" | "final" => {
  const representative = duplicateGroup.get(Number(id)) ?? Number(id);
  return representative < 300 ? "tuning" : representative < 400 ? "validation" : "final";
};
const exists = async (filePath: string): Promise<boolean> => stat(filePath).then(() => true).catch(() => false);
const normalize = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const numeric = (value: string): number | null => {
  const cleaned = value.replace(/[A-Za-z$€£\s()]/g, "");
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  const parsed = Number(comma > dot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const expectedDate = (value: string | undefined): string | null => {
  if (!value) return null;
  if (/^20\d{2}-\d{1,2}-\d{1,2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return year + "-" + month.padStart(2, "0") + "-" + day.padStart(2, "0");
  }
  const match = value.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = match[3].length === 2 ? "20" + match[3] : match[3];
  // SROIE is predominantly day/month/year, but its labels include a few
  // unambiguous month/day/year receipts. Resolve those by the value > 12;
  // retain day/month order only when both values are ambiguous.
  const month = first > 12 ? second : second > 12 ? first : second;
  const day = first > 12 ? first : second > 12 ? second : first;
  return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
};
const fieldCorrect = (field: ReceiptFrontendField, predicted: string | null | undefined, expected: string | null): boolean => {
  if (!predicted || !expected) return false;
  if (field === "vendor") {
    const actual = normalize(predicted);
    const target = normalize(expected);
    return actual.includes(target) || target.includes(actual);
  }
  if (field === "purchase_date") return predicted === expected;
  const actual = numeric(predicted);
  const target = numeric(expected);
  return actual !== null && target !== null && Math.abs(actual - target) < 0.005;
};

type Label = { company?: string; date?: string; total?: string };
type RawLine = { text: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number }; polygon?: Array<[number, number]>; bandIndex?: number; bandTop?: number; bandBottom?: number; observationKey?: string };
type RawRow = { id: string; observations?: RawLine[]; extraction?: { fields?: ReceiptFrontendFields }; category?: string; [key: string]: unknown };
type RawFile = { rows: RawRow[]; config?: ReceiptHierarchicalConfig; firstPass?: { name?: string; bandHeightMode?: string; bandHeight?: number; overlap?: number; preprocessing?: string; maxDimension?: number; includeWholeImage?: boolean }; model?: { modelBytes?: number; runtimeBytes?: number }; hierarchicalModel?: { totalBytes?: number; routerBytes?: number; expertBytes?: number }; initializationMs?: number; firstPassMs?: { mean?: number; p95?: number }; expertMs?: { mean?: number; p95?: number }; totalMs?: { mean?: number; p95?: number }; preparationMs?: { mean?: number } };

const labelsFor = async (id: string): Promise<Label> => JSON.parse(await readFile(path.join(root, "benchmarks/sroie500/labels", id + ".json"), "utf8")) as Label;

const bandInputs = (observations: RawLine[]): { bands: ReceiptRouterBandInput[]; first: ReceiptHierarchicalObservation[] } => {
  const grouped = new Map<string, RawLine[]>();
  observations.forEach((line) => {
    const key = String(line.observationKey ?? "");
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  });
  const bands = [...grouped.entries()].map(([key, lines]) => {
    const top = Math.min(...lines.map((line) => Number(line.bandTop ?? 0)));
    const bottom = Math.max(...lines.map((line) => Number(line.bandBottom ?? 1)));
    const width = Math.max(1, ...lines.map((line) => Number(line.bbox?.x1 ?? 0)));
    return { bandIndex: Number(lines[0]?.bandIndex ?? -1), observationKey: key, top, bottom, width, height: Math.max(1, bottom - top), lines: lines as ReceiptOcrLine[] };
  });
  return {
    bands,
    first: observations.map((line) => ({ ...line, bandIndex: Number(line.bandIndex ?? -1), bandTop: Number(line.bandTop ?? 0), bandBottom: Number(line.bandBottom ?? 1), observationKey: String(line.observationKey ?? ""), sourcePass: "first-pass" as const })),
  };
};

const simulateExperts = (observations: RawLine[], bands: ReceiptRouterBandInput[], config: ReceiptHierarchicalConfig) => {
  const predictions = classifyReceiptBands(bands, config);
  const crops = buildAdaptiveExpertCrops(bands, predictions, config);
  const byKey = new Map<string, RawLine[]>();
  observations.forEach((line) => {
    const key = String(line.observationKey ?? "");
    byKey.set(key, [...(byKey.get(key) ?? []), line]);
  });
  const experts: ReceiptHierarchicalObservation[] = [];
  // Cached replay has one OCR observation per proposed crop. Early stopping is
  // exercised by the browser runner, where trust can be checked immediately
  // after each sequential OCR call; replay keeps the full crop set so that the
  // quality comparison is not confounded by a cost-only simulation.
  crops.forEach((crop) => {
    const source = byKey.get(crop.sourceObservationKey) ?? [];
    const lines = source.filter((line) => {
      if (!line.bbox) return true;
      const center = (Number(line.bbox.y0) + Number(line.bbox.y1)) / 2;
      return center >= crop.top && center <= crop.bottom && Number(line.bbox.x1) >= crop.left && Number(line.bbox.x0) <= crop.right;
    });
    lines.forEach((line) => experts.push({ ...line, bandIndex: crop.sourceBandIndex, bandTop: crop.top, bandBottom: crop.bottom, observationKey: crop.cropId, sourcePass: "expert", expertCategory: crop.category, cropId: crop.cropId, routerProbability: crop.routerProbability }));
  });
  const processedCrops = crops;
  const specialistCropsSkippedEarly = 0;
  const viewCount = config.expertPreprocessingVariants?.length ?? 1;
  return { predictions, crops, processedCrops, experts, specialistCropsSkippedEarly, specialistViewInvocations: processedCrops.length * viewCount };
};

const scoreExtraction = async (rows: Array<{ id: string; extraction: ReceiptHierarchicalExtraction | { fields?: ReceiptFrontendFields }; unresolvedFields?: ReceiptFrontendField[] }>) => {
  const metrics = Object.fromEntries(fields.map((field) => [field, { expected: 0, trusted: 0, correct: 0, wrongTrusted: 0 }])) as Record<ReceiptFrontendField, { expected: number; trusted: number; correct: number; wrongTrusted: number }>;
  let unresolved = 0;
  let fallback = 0;
  let wholeResolved = 0;
  for (const row of rows) {
    const extracted = row.extraction.fields;
    if (!extracted) continue;
    const unresolvedFields = row.unresolvedFields ?? fields.filter((field) => extracted[field].status !== "trusted");
    unresolved += unresolvedFields.length;
    if (unresolvedFields.length) fallback += 1;
    else wholeResolved += 1;
    const label = await labelsFor(row.id);
    const expected: Partial<Record<ReceiptFrontendField, string | null>> = { vendor: label.company ?? null, purchase_date: expectedDate(label.date), total: label.total ?? null };
    fields.forEach((field) => {
      const metric = metrics[field];
      if (expected[field]) metric.expected += 1;
      const value = extracted[field];
      if (value.status !== "trusted") return;
      metric.trusted += 1;
      if (!expected[field]) return;
      if (fieldCorrect(field, value.value, expected[field] ?? null)) metric.correct += 1;
      else metric.wrongTrusted += 1;
    });
  }
  const fieldResults = Object.fromEntries(fields.map((field) => {
    const metric = metrics[field];
    return [field, { ...metric, precision: metric.expected && metric.trusted ? metric.correct / Math.max(1, metric.correct + metric.wrongTrusted) : null, recall: metric.expected ? metric.correct / metric.expected : null, coverage: metric.trusted / Math.max(1, rows.length) }];
  }));
  const known = knownFields.reduce((value, field) => ({ trusted: value.trusted + metrics[field].trusted, correct: value.correct + metrics[field].correct, wrongTrusted: value.wrongTrusted + metrics[field].wrongTrusted }), { trusted: 0, correct: 0, wrongTrusted: 0 });
  return { sampleSize: rows.length, fields: fieldResults, known: { ...known, precision: known.trusted ? known.correct / Math.max(1, known.correct + known.wrongTrusted) : null, coverage: known.trusted / Math.max(1, rows.length * knownFields.length) }, trustedFieldRate: fields.reduce((sum, field) => sum + metrics[field].trusted, 0) / Math.max(1, rows.length * fields.length), meanUnresolvedFields: unresolved / Math.max(1, rows.length), gptWorkUnits: unresolved, receiptFallbackRate: fallback / Math.max(1, rows.length), wholeReceiptResolvedRate: wholeResolved / Math.max(1, rows.length) };
};

const routerTruth = (category: string, lines: RawLine[], label: Label): boolean => {
  const joined = lines.map((line) => line.text).join(" ");
  const amounts = /(?:[$€£]|\b(?:rm|usd|cad|gbp)\b)?\s*\(?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?/gi;
  if (category === "vendor") {
    const expected = normalize(label.company ?? "");
    return Boolean(expected && lines.some((line) => normalize(line.text).includes(expected) || expected.includes(normalize(line.text))));
  }
  if (category === "purchase_date") return Boolean(label.date && lines.some((line) => line.text.includes(label.date as string)));
  if (category === "total") return Boolean(label.total && lines.some((line) => [...line.text.matchAll(amounts)].some((match) => Math.abs((numeric(match[0]) ?? -999999) - (numeric(label.total as string) ?? -999999)) < 0.005)));
  if (category === "subtotal") return /\bsub[ -]?total\b/i.test(joined) && amounts.test(joined);
  if (category === "tax") return /\b(?:tax|gst|hst|vat|sales tax)\b/i.test(joined) && amounts.test(joined);
  if (category === "receipt_id") return /\b(?:invoice|receipt|order|transaction|reference|ref|id|no\.?|number)\b/i.test(joined) && /[A-Z0-9]{3,}/i.test(joined);
  if (category === "item") return /\b(?:item|qty|quantity|price|sku|product|description|unit)\b/i.test(joined) || [...joined.matchAll(amounts)].length >= 3;
  return !categories.slice(0, -1).some((candidate) => routerTruth(candidate, lines, label));
};

const routerMetrics = async (rows: RawRow[], config: ReceiptHierarchicalConfig) => {
  const counts = Object.fromEntries(categories.map((category) => [category, { tp: 0, fp: 0, fn: 0, tn: 0, topHits: [0, 0, 0] }])) as Record<typeof categories[number], { tp: number; fp: number; fn: number; tn: number; topHits: number[] }>;
  for (const row of rows) {
    const label = await labelsFor(row.id);
    const { bands } = bandInputs(row.observations ?? []);
    const predictions = classifyReceiptBands(bands, config);
    const rankedByCategory = Object.fromEntries(categories.map((category) => [category, predictions.map((prediction, index) => ({ index, score: prediction.rankingScores?.[category as keyof typeof prediction.rankingScores] ?? prediction.probabilities[category] ?? 0 })).sort((left, right) => right.score - left.score).map((item) => item.index)])) as Record<typeof categories[number], number[]>;
    bands.forEach((band, index) => categories.forEach((category) => {
      const truth = routerTruth(category, band.lines as RawLine[], label);
      const predicted = predictions[index]?.routes.includes(category as never) ?? false;
      if (truth && predicted) counts[category].tp += 1;
      else if (!truth && predicted) counts[category].fp += 1;
      else if (truth) counts[category].fn += 1;
      else counts[category].tn += 1;
      if (truth) {
        const rank = rankedByCategory[category].indexOf(index);
        [1, 2, 3].forEach((n, nIndex) => { if (rank >= 0 && rank < n) counts[category].topHits[nIndex] += 1; });
      }
    }));
  }
  return Object.fromEntries(categories.map((category) => {
    const item = counts[category];
    const positives = item.tp + item.fn;
    return [category, { tp: item.tp, fp: item.fp, fn: item.fn, tn: item.tn, precision: item.tp + item.fp ? item.tp / (item.tp + item.fp) : null, recall: positives ? item.tp / positives : null, topNRecall: Object.fromEntries([1, 2, 3].map((n, index) => [`top${n}`, positives ? item.topHits[index] / positives : null])) }];
  }));
};

const replay = async (rawRows: RawRow[], config: ReceiptHierarchicalConfig) => {
  const rows: Array<{ id: string; extraction: ReceiptHierarchicalExtraction }> = [];
  let firstPassLines = 0;
  let expertLines = 0;
  let specialistInvocations = 0;
  let mergedLines = 0;
  for (const raw of rawRows) {
    const input = bandInputs(raw.observations ?? []);
    const simulated = simulateExperts(raw.observations ?? [], input.bands, config);
    const extraction = extractReceiptFieldsFromHierarchicalBands(input.first, simulated.experts, { config, routerPredictions: simulated.predictions, expertCrops: simulated.crops });
    rows.push({ id: raw.id, extraction });
    firstPassLines += input.first.length;
    expertLines += simulated.experts.length;
    specialistInvocations += simulated.processedCrops.length;
    mergedLines += extraction.mergedLines.length;
  }
  return { rows, score: await scoreExtraction(rows), router: await routerMetrics(rawRows, config), firstPassLines, expertLines, specialistInvocations, meanMergedLines: mergedLines / Math.max(1, rawRows.length) };
};

const funnelStages = ["routerEligibleBands", "routedBands", "cropsProposed", "ocrCrops", "ocrLines", "candidateValues", "modelPassing", "agreementEligible", "trusted"] as const;
const funnelAggregate = (rows: Array<{ extraction?: unknown }>) => {
  const result: Record<string, Record<string, number>> = {};
  rows.forEach((row) => {
    const funnel = (row.extraction as { funnel?: { byCategory?: Record<string, Record<string, number>> } } | undefined)?.funnel?.byCategory;
    if (!funnel) return;
    Object.entries(funnel).forEach(([category, values]) => {
      const aggregate = result[category] ?? Object.fromEntries(funnelStages.map((stage) => [stage, 0]));
      funnelStages.forEach((stage) => { aggregate[stage] += Number(values[stage] ?? 0); });
      result[category] = aggregate;
    });
  });
  return result;
};

const percentage = (value: number | null | undefined): string => value == null ? "n/a" : (value * 100).toFixed(1) + "%";
const toControlRows = (rows: Array<Record<string, unknown>>) => rows.map((row) => ({ id: String(row.id), extraction: { fields: (row.fields ?? {}) as ReceiptFrontendFields }, unresolvedFields: row.unresolvedFields as ReceiptFrontendField[] | undefined }));
const browserRowToRaw = (row: RawRow): RawRow => ({ ...row, observations: (row.firstPassObservations ?? []) as RawLine[] });
const meanRowNumber = (rows: RawRow[], key: string): number | null => {
  const values = rows.map((row) => Number(row[key])).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const browserCost = (file: RawFile | null) => file ? {
  sampleSize: file.rows.length,
  ocrModelBytes: file.model?.modelBytes ?? null,
  ocrRuntimeBytes: file.model?.runtimeBytes ?? null,
  firstPassConfig: file.firstPass ? { name: file.firstPass.name, bandHeightMode: file.firstPass.bandHeightMode, bandHeight: file.firstPass.bandHeight, overlap: file.firstPass.overlap, preprocessing: file.firstPass.preprocessing, maxDimension: file.firstPass.maxDimension, includeWholeImage: file.firstPass.includeWholeImage } : null,
  initializationMs: file.initializationMs ?? null,
  firstPassMeanMs: file.firstPassMs?.mean ?? null,
  firstPassP95Ms: file.firstPassMs?.p95 ?? null,
  expertMeanMs: file.expertMs?.mean ?? null,
  expertP95Ms: file.expertMs?.p95 ?? null,
  totalMeanMs: file.totalMs?.mean ?? null,
  totalP95Ms: file.totalMs?.p95 ?? null,
  preparationMeanMs: file.preparationMs?.mean ?? null,
  firstPassInvocationsPerReceipt: meanRowNumber(file.rows, "firstPassOcrInvocations"),
  specialistCropsProposedPerReceipt: meanRowNumber(file.rows, "specialistCropsProposed"),
  specialistInvocationsPerReceipt: meanRowNumber(file.rows, "specialistInvocations"),
  specialistViewInvocationsPerReceipt: meanRowNumber(file.rows, "specialistViewInvocations"),
  specialistCropsSkippedEarlyPerReceipt: meanRowNumber(file.rows, "specialistCropsSkippedEarly"),
  totalOcrInvocationsPerReceipt: (meanRowNumber(file.rows, "firstPassOcrInvocations") ?? 0) + (meanRowNumber(file.rows, "specialistInvocations") ?? 0),
  firstPassLinesPerReceipt: meanRowNumber(file.rows, "firstPassLineCount"),
  expertLinesPerReceipt: meanRowNumber(file.rows, "expertLineCount"),
  heapAfterMeanBytes: meanRowNumber(file.rows, "heapAfter"),
  heapAfterMaxBytes: Math.max(0, ...file.rows.map((row) => Number(row.heapAfter)).filter((value) => Number.isFinite(value))),
} : null;
const firstPassDescription = (name: string | undefined): string => {
  const candidate = RECEIPT_BAND_SCREENING_CONFIGS.find((config) => config.name === name);
  if (!candidate) return name ?? "default";
  const height = candidate.bandHeightMode === "fraction" ? `${Math.round((candidate.bandHeight ?? 0) * 100)}%` : `${candidate.bandHeight ?? "?"} ${candidate.bandHeightMode}`;
  return `${height} height / ${Math.round(candidate.overlap * 100)}% overlap / ${candidate.preprocessing} / ${candidate.includeWholeImage ? "whole+band" : "band-only"} / max ${candidate.maxDimension}`;
};
const gptWorkFor = (controls: Record<string, unknown>, name: string): number | null => {
  const value = controls[name];
  if (!value || typeof value !== "object" || !("gptWorkUnits" in value)) return null;
  const units = Number((value as { gptWorkUnits?: unknown }).gptWorkUnits);
  return Number.isFinite(units) ? units : null;
};
const percentageDelta = (baseline: number | null, current: number): string => baseline === null || baseline === 0 ? "n/a" : `${(((baseline - current) / baseline) * 100).toFixed(1)}%`;

describe("hierarchical PP-OCRv6 benchmark", () => {
  it("scores receipt-level router/expert screens and writes aggregate-only artifacts", async () => {
    if (!(await exists(inputPath))) {
      console.warn("Skipping hierarchical benchmark: " + inputPath + " is not cached");
      return;
    }
    const raw = JSON.parse(await readFile(inputPath, "utf8")) as RawFile;
    const benchmarkStartedAt = Date.now();
    // Keep the untouched final receipts out of every candidate screen. The
    // selected configuration is replayed on final exactly once below, after
    // validation-only selection has completed.
    const screenRows = raw.rows.filter((row) => splitFor(row.id) !== "final");
    const finalRows = raw.rows.filter((row) => splitFor(row.id) === "final");
    const replayResults = await Promise.all(RECEIPT_HIERARCHICAL_SCREENING_CONFIGS.map(async (config) => ({ config, ...(await replay(screenRows, config)) })));
    const validationResults = await Promise.all(replayResults.map(async (item) => ({ ...item, validation: await scoreExtraction(item.rows.filter((row) => splitFor(row.id) === "validation")), validationRouter: await routerMetrics(raw.rows.filter((row) => splitFor(row.id) === "validation"), item.config) })));
    const safeValidation = validationResults.filter((item) => item.validation.known.wrongTrusted === 0);
    const selected = [...(safeValidation.length ? safeValidation : validationResults)].sort((left, right) => right.validation.known.correct - left.validation.known.correct || left.specialistInvocations - right.specialistInvocations)[0] ?? replayResults[0];
    const selectedValidation = await scoreExtraction(selected.rows.filter((row) => splitFor(row.id) === "validation"));
    // This is the only selected-pipeline evaluation on the untouched final
    // split. Do not use it for configuration selection or threshold tuning.
    const selectedFinalReplay = await replay(finalRows, selected.config);
    const selectedAllReplayRows = [...selected.rows, ...selectedFinalReplay.rows];
    const selectedAllReplay = await scoreExtraction(selectedAllReplayRows);
    const controls: Record<string, unknown> = {};
    if (await exists(tesseractPath)) {
      const file = JSON.parse(await readFile(tesseractPath, "utf8"));
      controls["tesseract-rules"] = await scoreExtraction(toControlRows(file.strategies.baseline));
    }
    if (await exists(ppocrPath)) {
      const file = JSON.parse(await readFile(ppocrPath, "utf8"));
      controls["ppocrv6-whole-old-rules"] = await scoreExtraction(toControlRows(Object.values(file.engines)[0].rows));
    }
    // The committed prior benchmark reports this selector as an aggregate;
    // retain it as a control without re-reading/tuning its private raw rows.
    controls["ppocrv6-current-adapted-selector"] = { sampleSize: raw.rows.length, known: { trusted: 134, correct: 129, wrongTrusted: 4, precision: 129 / 133, coverage: 134 / (raw.rows.length * knownFields.length) }, meanUnresolvedFields: 4.41, gptWorkUnits: 2207, wholeReceiptResolvedRate: 0 };
    // Commit 5569ad1 is the immediately preceding top-3 hierarchical
    // selector. Keep its aggregate as a fixed control; it is not used for
    // specialist fitting or validation selection.
    controls["commit-5569ad1-hierarchical"] = { sampleSize: raw.rows.length, known: { trusted: 145, correct: 142, wrongTrusted: 2, precision: 142 / 144, coverage: 145 / (raw.rows.length * knownFields.length) }, meanUnresolvedFields: 4.71, gptWorkUnits: 2354, wholeReceiptResolvedRate: 0 };
    // Commit 8a3aac4 is the previous all-band hybrid. Its aggregate is kept
    // as a historical control from the committed report; its raw private
    // production artifacts are intentionally not reloaded here.
    controls["commit-8a3aac4-band-hybrid"] = { sampleSize: raw.rows.length, known: { trusted: 359, correct: 344, wrongTrusted: 15, precision: 344 / 359, coverage: 359 / (raw.rows.length * knownFields.length) }, meanUnresolvedFields: 3.80, gptWorkUnits: 1899, wholeReceiptResolvedRate: 0 };
    // Historical aggregate from the committed 8d2e757 hierarchical run. Its
    // fresh-browser output is retained as a control, but it is not reused for
    // threshold selection or final evaluation.
    controls["commit-8d2e757-hierarchical"] = { sampleSize: raw.rows.length, known: { trusted: 6, correct: 6, wrongTrusted: 0, precision: 1, coverage: 6 / (raw.rows.length * knownFields.length) }, meanUnresolvedFields: 4.98, gptWorkUnits: 2492, wholeReceiptResolvedRate: 0 };
    const selectedBrowserPaths = [
      path.join(root, `benchmarks/receipt-hierarchical-sroie-all-${selected.config.name}.json`),
      path.join(root, `benchmarks/receipt-hierarchical-sroie-validation-${selected.config.name}.json`),
      path.join(root, `benchmarks/receipt-hierarchical-sroie-final-${selected.config.name}.json`),
    ];
    const selectedBrowserFiles = (await Promise.all(selectedBrowserPaths.map(async (candidate) => await exists(candidate) ? JSON.parse(await readFile(candidate, "utf8")) as RawFile : null))).filter((file): file is RawFile => Boolean(file));
    const selectedBrowser = selectedBrowserFiles.length ? { ...selectedBrowserFiles[0], rows: selectedBrowserFiles.flatMap((file) => file.rows) } : null;
    const selectedActualRows = selectedBrowser?.rows.map(browserRowToRaw).map((row) => ({ id: row.id, extraction: row.extraction as unknown as ReceiptHierarchicalExtraction, unresolvedFields: (row.extraction as { unresolvedFields?: ReceiptFrontendField[] } | undefined)?.unresolvedFields })) ?? [];
    const selectedActual = selectedActualRows.length ? await scoreExtraction(selectedActualRows) : null;
    const selectedActualAll = selectedActual && selectedActual.sampleSize === raw.rows.length ? selectedActual : null;
    const selectedActualValidation = selectedActualRows.length ? await scoreExtraction(selectedActualRows.filter((row) => splitFor(row.id) === "validation")) : null;
    const selectedActualFinal = selectedActualRows.length ? await scoreExtraction(selectedActualRows.filter((row) => splitFor(row.id) === "final")) : null;
    const productionPaths = [
      path.join(root, `benchmarks/receipt-hierarchical-production-all-${selected.config.name}.json`),
      path.join(root, "benchmarks/receipt-hierarchical-production-all-adaptive-medium-min2.json"),
      path.join(root, "benchmarks/receipt-hierarchical-production-all-adaptive-wide-tuned-min2.json"),
    ];
    let productionPath: string | null = null;
    for (const candidate of productionPaths) {
      if (await exists(candidate)) {
        productionPath = candidate;
        break;
      }
    }
    const production = productionPath ? JSON.parse(await readFile(productionPath, "utf8")) as RawFile : null;
    const selectedFinal = selectedFinalReplay.score;
    const selectedValidationReport = selectedActualValidation ?? selectedValidation;
    const selectedFinalReport = selectedActualFinal ?? selectedFinal;
    const selectedAllReport = selectedActualAll ?? selectedAllReplay;
    const selectedReplayValidationFunnel = funnelAggregate(selected.rows.filter((row) => splitFor(row.id) === "validation"));
    const selectedReplayFinalFunnel = funnelAggregate(selectedFinalReplay.rows);
    const selectedActualFunnel = selectedActualRows.length ? funnelAggregate(selectedActualRows) : null;
    const selectedActualValidationFunnel = selectedActualRows.length ? funnelAggregate(selectedActualRows.filter((row) => splitFor(row.id) === "validation")) : null;
    const selectedActualFinalFunnel = selectedActualRows.length ? funnelAggregate(selectedActualRows.filter((row) => splitFor(row.id) === "final")) : null;
    const modelInfo = hierarchicalModelInfo();
    const processMemory = process.memoryUsage();
    const resourceUsage = process.resourceUsage();
    const offlineBenchmark = {
      runtimeMs: Date.now() - benchmarkStartedAt,
      rssBytes: processMemory.rss,
      heapUsedBytes: processMemory.heapUsed,
      peakRssBytes: Number.isFinite(resourceUsage.maxRSS) ? resourceUsage.maxRSS * 1024 : processMemory.rss,
    };
    const actualRouter = selectedBrowser ? await routerMetrics(selectedBrowser.rows.map(browserRowToRaw), selected.config) : selected.router;
    const selectedRouter = selectedBrowser ? actualRouter : selected.validationRouter;
    const modelComparison = await exists(modelComparisonPath) ? JSON.parse(await readFile(modelComparisonPath, "utf8")) as { router?: Record<string, { targetRecall?: number; comparisons?: Record<string, { validationGate?: { threshold?: number }; validation?: { precision?: number | null; coverage?: number; wrongTrusted?: number }; modelBytes?: number }> }>; experts?: Record<string, { validation?: { precision?: number | null; coverage?: number; wrongTrusted?: number }; modelBytes?: number }> } : null;
    const routerModelLines = modelComparison ? Object.entries(modelComparison.router ?? {}).flatMap(([category, value]) => Object.entries(value.comparisons ?? {}).map(([modelType, result]) => "| router " + category + " / " + modelType + " | " + (value.targetRecall ?? "n/a") + " | " + (result.validationGate?.threshold?.toFixed?.(3) ?? "n/a") + " | " + percentage(result.validation?.precision) + " | " + percentage(result.validation?.coverage) + " | " + (result.validation?.wrongTrusted ?? "n/a") + " | " + (result.modelBytes ?? "n/a") + " |")) : [];
    const expertModelLines = modelComparison ? Object.entries(modelComparison.experts ?? {}).map(([category, result]) => "| expert " + category + " / logistic | " + percentage(result.validation?.precision) + " | " + percentage(result.validation?.coverage) + " | " + (result.validation?.wrongTrusted ?? "n/a") + " | " + (result.modelBytes ?? "n/a") + " |") : [];
    const productionStatus = (rows: RawRow[]) => ({
      receipts: rows.length,
      fieldCounts: Object.fromEntries(fields.map((field) => [field, rows.reduce((sum, row) => sum + (row.extraction?.fields?.[field]?.status === "trusted" ? 1 : 0), 0)])),
      meanUnresolvedFields: rows.reduce((sum, row) => sum + (row.extraction?.fields ? fields.filter((field) => row.extraction?.fields?.[field]?.status !== "trusted").length : 5), 0) / Math.max(1, rows.length),
    });
    const productionWalmart = production?.rows.filter((row) => row.category === "walmart") ?? [];
    const productionOther = production?.rows.filter((row) => row.category !== "walmart") ?? [];
    const productionInventory = production ? { source: productionPath ? path.basename(productionPath) : null, sampleSize: production.rows.length, statusOnly: true, walmartReceipts: productionWalmart.length, fieldCounts: productionStatus(production.rows).fieldCounts, meanUnresolvedFields: productionStatus(production.rows).meanUnresolvedFields, walmart: productionStatus(productionWalmart), other: productionStatus(productionOther) } : { statusOnly: true, unavailable: true };
    const allGptWork = selectedAllReport.gptWorkUnits;
    const gptComparison = ["tesseract-rules", "ppocrv6-whole-old-rules", "ppocrv6-current-adapted-selector", "commit-5569ad1-hierarchical", "commit-8a3aac4-band-hybrid"].map((name) => `${name} ${gptWorkFor(controls, name) ?? "n/a"} (${percentageDelta(gptWorkFor(controls, name), allGptWork)} reduction)`).join(", ");
    const funnelConversion = (current: number | undefined, previous: number | undefined): string => previous ? percentage((current ?? 0) / previous) : "n/a";
    const reportLines = [
      "# Hierarchical PP-OCRv6 tiny mixture-of-experts benchmark", "",
      "The hierarchical path is experimental and is not wired into live receipt extraction. The current production path and fail-open behavior are unchanged.", "",
      "## Corpus and protocol", "",
      "SROIE public OCR cache: " + raw.rows.length + " receipts; grouped tuning/validation/final split " + raw.rows.filter((row) => splitFor(row.id) === "tuning").length + "/" + raw.rows.filter((row) => splitFor(row.id) === "validation").length + "/" + raw.rows.filter((row) => splitFor(row.id) === "final").length + ". Exact duplicate groups remain together.",
      "Router and specialist parameters were trained on tuning receipts. Configuration selection uses validation only; final is evaluated once after selection.",
      "The grouped SROIE labels expose vendor/date/total ground truth. Subtotal/tax/receipt-ID/item labels used by the router/trainer remain weak OCR/layout supervision and are not field-accuracy claims. A separate 25-receipt public SROIE final subset was independently image-reviewed for subtotal/tax; its held-out results are reported in `benchmarks/receipt-finance-evaluation-report.md` and were not used for training or configuration selection.", "",
      "## Router calibration diagnosis", "",
      "Commit 8d routed only the highest-scoring categories from each band using conservative model thresholds and a shared crop budget. In its fresh-browser screen, receipt-ID recall was approximately 6% and vendor recall approximately 24%, so the correct specialist frequently never received a crop; the final trust gate then correctly abstained. The new router thresholds are category-specific and selected for recall on grouped validation (vendor/date/subtotal/tax/total/receipt-ID/item targets 90%/95%/90%/98%/95%/98%/98%).",
      "The router is now a high-recall work allocator: category-specific top-band quotas, top-1/top-2/top-3 per-band fan-out, a broad geometry-only vendor header prior, and round-robin crop budgeting protect weak vendor/receipt-ID/item routes from starvation. Router false positives remain inexpensive specialist rejects and cannot make a field trusted.",
      "The final-total guard was also tightened after replay diagnostics: a standalone GST/tax payable label or a later total label cannot bless an earlier tax amount. Total labels must be on the amount line or immediately above it.", "",
      "Finance root cause and fix: the previous routed specialist treated every amount in a crop containing a subtotal/tax keyword as an equally valid candidate. GST summaries, discounts, payment/change lines, and total-inclusive text therefore created competing values before agreement. The new finance expert uses amount-to-label association (same-line/above-line order, relative column, amount rank, OCR confidence, and opposing-role labels), trains on weakly labelled explicit financial rows plus routed hard negatives, and keeps only the best role-associated amount per observation. Inclusive-tax/subtotal labels and tax metadata fail open. Amounts attached to an excluded-GST phrase, payment/change text, or an incomplete Amount/Tax column header are also rejected; a directly labelled parseable GST amount remains eligible. Equivalent currency/comma formatting is canonicalized before agreement; repeated overlapping/view copies remain one observation. An explicitly labelled, high-calibration finance prediction may bypass the two-observation requirement only when its own strict field gate and geometry checks pass. The validation-only finance gate screen compared subtotal/tax calibrated thresholds (.60/.65, .58/.58, and .55/.55); .58 for subtotal recovered two explicit subtotal rows, while tax remained at .65 because the lower tax slice admitted a GST-column/header false positive.", "",
      "## Validation screen", "",
      "| configuration | first-pass geometry | known precision | known coverage | wrong trusted | mean unresolved | specialist calls/receipt |", "|---|---|---:|---:|---:|---:|---:|",
      ...validationResults.map((item) => "| " + item.config.name + " | " + firstPassDescription(item.config.firstPassConfigName) + " | " + percentage(item.validation.known.precision) + " | " + percentage(item.validation.known.coverage) + " | " + item.validation.known.wrongTrusted + " | " + item.validation.meanUnresolvedFields.toFixed(2) + " | " + (item.specialistInvocations / Math.max(1, raw.rows.length)).toFixed(2) + " |"),
      "", "Selected configuration: **" + selected.config.name + "**. No final labels were used for selection.", "",
      "Second-pass screen varied tight/medium/wide/adaptive windows, crop padding, one/two/three independent-support gates, fan-out, and specialist thresholds. The replay screen reuses cached PP-OCRv6 observations; no new browser OCR artifact was available for the selected configuration, so fresh-browser rows are not claimed below.",
      "## Controls and selected pipeline", "",
      "Historical `fec6f03` selected replay (recorded before this iteration): validation had 61 known trusted fields at 0 wrong (20.3% known coverage); the untouched final had 60 known trusted fields with 59 labelled correct at 0 wrong (20.2% known coverage); all 500 had 253 known trusted fields, 242 labelled correct, and 9 wrong (96.4% known precision, 16.9% known coverage). This historical control was not used for selection.", "",
      "| path | known precision | known coverage | wrong trusted | mean unresolved | whole-receipt resolved |", "|---|---:|---:|---:|---:|---:|",
      ...Object.entries(controls).filter((entry): entry is [string, Awaited<ReturnType<typeof scoreExtraction>>] => typeof entry[1] !== "string").map(([name, value]) => "| " + name + " | " + percentage(value.known.precision) + " | " + percentage(value.known.coverage) + " | " + value.known.wrongTrusted + " | " + value.meanUnresolvedFields.toFixed(2) + " | " + percentage(value.wholeReceiptResolvedRate) + " |"),
      "| fec6f03 baseline (prior selected replay) | 96.4% | 16.9% | 9 | 4.49 | n/a |",
      "| hierarchical " + (selectedActualValidation ? "fresh" : "replay") + " validation (" + selectedValidationReport.sampleSize + ") | " + percentage(selectedValidationReport.known.precision) + " | " + percentage(selectedValidationReport.known.coverage) + " | " + selectedValidationReport.known.wrongTrusted + " | " + selectedValidationReport.meanUnresolvedFields.toFixed(2) + " | " + percentage(selectedValidationReport.wholeReceiptResolvedRate) + " |",
      "| hierarchical " + (selectedActualFinal ? "fresh" : "replay") + " untouched final (" + selectedFinalReport.sampleSize + ") | " + percentage(selectedFinalReport.known.precision) + " | " + percentage(selectedFinalReport.known.coverage) + " | " + selectedFinalReport.known.wrongTrusted + " | " + selectedFinalReport.meanUnresolvedFields.toFixed(2) + " | " + percentage(selectedFinalReport.wholeReceiptResolvedRate) + " |",
      "| hierarchical all 500 replay | " + percentage(selectedAllReport.known.precision) + " | " + percentage(selectedAllReport.known.coverage) + " | " + selectedAllReport.known.wrongTrusted + " | " + selectedAllReport.meanUnresolvedFields.toFixed(2) + " | " + percentage(selectedAllReport.wholeReceiptResolvedRate) + " |", "",
      "### All-500 replay field results", "", "| field | trusted | correct | wrong trusted | precision | recall | coverage |", "|---|---:|---:|---:|---:|---:|---:|",
      ...fields.map((field) => { const metric = selectedAllReport.fields[field] as Record<string, number | null>; return "| " + field + " | " + metric.trusted + " | " + metric.correct + " | " + metric.wrongTrusted + " | " + percentage(metric.precision) + " | " + percentage(metric.recall) + " | " + percentage(metric.coverage) + " |"; }),
      "", "### Untouched-final field results", "", "| field | trusted | correct | wrong trusted | precision | recall | coverage |", "|---|---:|---:|---:|---:|---:|---:|",
      ...fields.map((field) => { const metric = selectedFinalReport.fields[field] as Record<string, number | null>; return "| " + field + " | " + metric.trusted + " | " + metric.correct + " | " + metric.wrongTrusted + " | " + percentage(metric.precision) + " | " + percentage(metric.recall) + " | " + percentage(metric.coverage) + " |"; }),
      "", "All-500 whole-receipt local resolution: " + percentage(selectedAllReport.wholeReceiptResolvedRate) + "; mean unresolved " + selectedAllReport.meanUnresolvedFields.toFixed(2) + "; GPT field work " + selectedAllReport.gptWorkUnits + ".", "",
      "GPT work comparison (delta versus the named control; positive means reduction, negative means increase): " + gptComparison + ". The selected replay reduces unresolved-field work versus 5569 on the cached corpus; no new full browser run is claimed.", "",
      "## Router precision/recall", "", "| category | precision | recall | TP | FP | FN | TN |", "|---|---:|---:|---:|---:|---:|---:|",
      ...categories.map((category) => { const metric = selectedRouter[category] as Record<string, number | null | Record<string, number | null>>; return "| " + category + " | " + percentage(metric.precision as number | null) + " | " + percentage(metric.recall as number | null) + " | " + metric.tp + " | " + metric.fp + " | " + metric.fn + " | " + metric.tn + " |"; }),
      "", "These are multi-label one-vs-rest metrics. One band may correctly route multiple categories; this is not a mutually-exclusive confusion matrix.", "",
      "### Ranked-band recall (top-N)", "", "The top-N figures are category-specific ranked-band recall before the per-band fan-out cap. They show whether the specialist's true region is among the first 1, 2, or 3 router candidates; router precision is intentionally not used as a trust gate.", "", "| category | top-1 recall | top-2 recall | top-3 recall |", "|---|---:|---:|---:|",
      ...categories.map((category) => { const metric = selectedRouter[category] as { topNRecall?: Record<string, number | null> }; return "| " + category + " | " + percentage(metric.topNRecall?.top1) + " | " + percentage(metric.topNRecall?.top2) + " | " + percentage(metric.topNRecall?.top3) + " |"; }),
      "", "### Fan-out and category-threshold screen (validation)", "", "Fan-out is the maximum number of categories routed from one band. Each configuration also applies category-specific top-band quotas; the router threshold is recall-first and does not gate final trust.", "", "| configuration | fan-out | vendor R | date R | total R | receipt-ID R | item R | top-1/2/3 mean R |", "|---|---:|---:|---:|---:|---:|---:|---:|",
      ...validationResults.map((item) => { const get = (category: string) => (item.validationRouter[category] as { recall?: number | null })?.recall ?? null; const top = categories.map((category) => item.validationRouter[category] as { topNRecall?: Record<string, number | null> }).filter((metric) => metric.topNRecall); const mean = (key: string) => top.length ? top.reduce((sum, metric) => sum + (metric.topNRecall?.[key] ?? 0), 0) / top.length : null; return "| " + item.config.name + " | " + item.config.maxCategoriesPerBand + " | " + percentage(get("vendor")) + " | " + percentage(get("purchase_date")) + " | " + percentage(get("total")) + " | " + percentage(get("receipt_id")) + " | " + percentage(get("item")) + " | " + percentage(mean("top1")) + " / " + percentage(mean("top2")) + " / " + percentage(mean("top3")) + " |"; }),
      "", "### Per-stage funnel (selected replay validation)", "", "Counts are summed over the 100 grouped validation receipts. The path is router eligibility → routed band/category pair → proposed crop → crop returning OCR lines → candidate value → specialist model pass → independent agreement → final trusted value. A zero at a later stage is an abstention, not a forced guess. Conversion columns expose where agreement and final trust are lost.", "", "| category | eligible | routed | crops | OCR crops | OCR lines | candidates | model pass | agreement | trusted | model→agreement | agreement→trusted |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...categories.filter((category): category is Exclude<typeof categories[number], "other"> => category !== "other").map((category) => { const item = selectedActualValidationFunnel?.[category] ?? selectedReplayValidationFunnel[category] ?? {}; return "| " + category + " | " + (item.routerEligibleBands ?? 0) + " | " + (item.routedBands ?? 0) + " | " + (item.cropsProposed ?? 0) + " | " + (item.ocrCrops ?? 0) + " | " + (item.ocrLines ?? 0) + " | " + (item.candidateValues ?? 0) + " | " + (item.modelPassing ?? 0) + " | " + (item.agreementEligible ?? 0) + " | " + (item.trusted ?? 0) + " | " + funnelConversion(item.agreementEligible, item.modelPassing) + " | " + funnelConversion(item.trusted, item.agreementEligible) + " |"; }),
      "", "Final funnel (untouched final split): " + JSON.stringify(selectedActualFinalFunnel ?? selectedReplayFinalFunnel) + ". All-500 funnel when fresh browser output is available: " + JSON.stringify(selectedActualFunnel ?? null) + ".",
      "## Model and specialist screen", "", "| component | target recall | route threshold | validation precision | validation coverage | validation wrong | serialized bytes |", "|---|---:|---:|---:|---:|---:|---:|",
      ...routerModelLines,
      ...expertModelLines.map((line) => line.replace(/^\| expert ([^|]+) \| /, "| expert $1 | n/a | n/a | ")),
      "", "The shipped representation is logistic for all router/specialist categories; stump-forest and boosted-stump router candidates are benchmarked above but are not encoded in the browser bundle because they did not provide a safe validated advantage at their tested size.", "",
      "## Cost, deduplication, and production", "",
      "Replay plan: " + ((selected.firstPassLines + selectedFinalReplay.firstPassLines) / Math.max(1, raw.rows.length)).toFixed(2) + " first-pass line observations/receipt, " + ((selected.specialistInvocations + selectedFinalReplay.specialistInvocations) / Math.max(1, raw.rows.length)).toFixed(2) + " specialist crops/receipt, " + ((selected.expertLines + selectedFinalReplay.expertLines) / Math.max(1, raw.rows.length)).toFixed(2) + " specialist line observations/receipt. Replay is a selector/router screen over cached PP-OCRv6 observations; it does not claim new OCR quality.",
      "Offline benchmark process cost: " + (offlineBenchmark.runtimeMs / 1000).toFixed(1) + "s wall time, " + Math.round(offlineBenchmark.peakRssBytes / 1024 / 1024) + " MiB peak RSS, " + Math.round(offlineBenchmark.heapUsedBytes / 1024 / 1024) + " MiB heap used at report time. This is the Node replay cost, not a mobile-browser measurement.",
      "Full selected browser run: " + (selectedBrowser ? JSON.stringify(browserCost(selectedBrowser)) : "not cached; replay specialist cost is an upper bound because the browser now early-stops a category after safe trust") + ". Hierarchical model JSON: " + JSON.stringify(modelInfo) + " bytes by serialized component; PP-OCRv6 asset/runtime sizes are included in the browser-cost object. Peak heap is an optional browser metric.",
      "Specialist invocation is category-routed: a total crop is sent only to the total expert, and a crop with no selected category receives no specialist. Overlapping copies are merged before support counts; identical observation keys never count twice.",
      "Read-only GCS status inventory: " + JSON.stringify(productionInventory) + ". Production has no independent field labels, so it is not used for precision claims or tuning.", "",
      "## Decision", "", "No promotion is made. The adaptive path remains experimental: on the separate independently reviewed finance subset it trusted 9/11 verified subtotals and 22/24 verified taxes at 100% precision with zero wrong-trusted labels, but the sample is small and two finance values still abstain. Production receipts have no independent field labels, so they cannot support accuracy claims. Uncertain fields remain unresolved for GPT. No 99.5% or 99.9% retention claim is made; a full selected browser run is not cached and the untouched grouped final split contains only 99 receipts.", "",
    ];
    await writeFile(path.join(root, "benchmarks/receipt-hierarchical-benchmark-report.md"), reportLines.join("\n"));
    await writeFile(path.join(root, "benchmarks/receipt-hierarchical-benchmark-results.json"), JSON.stringify({ controls, selected: { config: selected.config.name, replay: selectedAllReplay, validation: selectedValidationReport, final: selectedFinalReport, actualBrowser: selectedActual, replayValidationFunnel: selectedReplayValidationFunnel, replayFinalFunnel: funnelAggregate(selectedFinalReplay.rows), actualFunnel: selectedActualFunnel, actualValidationFunnel: selectedActualValidationFunnel, actualFinalFunnel: selectedActualFinalFunnel }, configurations: replayResults.map((item) => ({ config: item.config.name, screenScore: item.score, router: item.router, specialistInvocations: item.specialistInvocations, validationFunnel: funnelAggregate(item.rows.filter((row) => splitFor(row.id) === "validation")) })), production: productionInventory, browser: browserCost(selectedBrowser), model: modelInfo, offlineBenchmark }, null, 2));
    expect(raw.rows.length).toBeGreaterThanOrEqual(500);
  }, 900_000);
});
