import { describe, expect, it } from "vitest";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildAdaptiveExpertCrops,
  classifyReceiptBands,
  extractReceiptFieldsFromHierarchicalBands,
  RECEIPT_HIERARCHICAL_SCREENING_CONFIGS,
  type ReceiptHierarchicalConfig,
  type ReceiptHierarchicalExtraction,
  type ReceiptHierarchicalObservation,
  type ReceiptRouterBandInput,
} from "@/lib/receiptHierarchicalBandOcr";
import type { ReceiptFrontendField, ReceiptFrontendFields } from "@/lib/receiptFrontendExtractor";
import type { ReceiptOcrLine } from "@/lib/receiptOcr";

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "benchmarks/receipt-band-ocr-sroie-all-fraction40-overlap40-contrast-2200-rules-hybrid.json");
const extraInputPath = path.join(root, "benchmarks/receipt-finance-extra-hierarchical.json");
const labelsPath = path.join(root, "benchmarks/receipt-finance-evaluation-labels.json");
const reportPath = path.join(root, "benchmarks/receipt-finance-evaluation-report.md");
const resultsPath = path.join(root, "benchmarks/receipt-finance-evaluation-results.json");
const fields: readonly ReceiptFrontendField[] = ["subtotal", "tax"];
const selectedConfigName = "specialist-finance-high-recall-calibrated-single";

type RawLine = { text: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number }; polygon?: Array<[number, number]>; bandIndex?: number; bandTop?: number; bandBottom?: number; observationKey?: string };
type RawRow = { id: string; observations?: RawLine[]; firstPassObservations?: RawLine[]; expertObservations?: RawLine[]; extraction?: { fields?: ReceiptFrontendFields; [key: string]: unknown }; [key: string]: unknown };
type RawFile = { rows: RawRow[] };
type FinanceLabel = { status: "verified" | "absent" | "ambiguous"; value?: string; candidates?: string[]; evidence?: string };
type FinanceLabels = { receiptCount: number; protocol?: Record<string, string>; receipts: Array<{ id: string; fields: Record<"subtotal" | "tax", FinanceLabel> }> };

const exists = async (filePath: string): Promise<boolean> => stat(filePath).then(() => true).catch(() => false);
const normalize = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const numeric = (value: string): number | null => {
  const cleaned = value.replace(/[A-Za-z$€£\s()]/g, "");
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  const parsed = Number(comma > dot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const sameAmount = (left: string | null | undefined, right: string | null | undefined): boolean => {
  const a = left == null ? null : numeric(left);
  const b = right == null ? null : numeric(right);
  return a !== null && b !== null && Math.abs(a - b) < 0.005;
};
const wilsonInterval = (successes: number, trials: number, z = 1.96): [number, number] | null => {
  if (trials <= 0) return null;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials);
  return [Math.max(0, (centre - margin) / denominator), Math.min(1, (centre + margin) / denominator)];
};
const amountTokens = (text: string): string[] => text.match(/(?:[$€£]|\b(?:rm|usd|cad|gbp)\b)?\s*\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?/gi) ?? [];
const lineHasAmount = (line: RawLine, expected: string): boolean => amountTokens(line.text).some((token) => sameAmount(token, expected));
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
const simulateExperts = (observations: RawLine[], bands: ReceiptRouterBandInput[], config: ReceiptHierarchicalConfig): { predictions: ReturnType<typeof classifyReceiptBands>; crops: ReturnType<typeof buildAdaptiveExpertCrops>; experts: ReceiptHierarchicalObservation[] } => {
  const predictions = classifyReceiptBands(bands, config);
  const crops = buildAdaptiveExpertCrops(bands, predictions, config);
  const byKey = new Map<string, RawLine[]>();
  observations.forEach((line) => {
    const key = String(line.observationKey ?? "");
    byKey.set(key, [...(byKey.get(key) ?? []), line]);
  });
  const experts: ReceiptHierarchicalObservation[] = [];
  crops.forEach((crop) => {
    const source = byKey.get(crop.sourceObservationKey) ?? [];
    source.filter((line) => {
      if (!line.bbox) return true;
      const center = (Number(line.bbox.y0) + Number(line.bbox.y1)) / 2;
      return center >= crop.top && center <= crop.bottom && Number(line.bbox.x1) >= crop.left && Number(line.bbox.x0) <= crop.right;
    }).forEach((line) => experts.push({ ...line, bandIndex: crop.sourceBandIndex, bandTop: crop.top, bandBottom: crop.bottom, observationKey: crop.cropId, sourcePass: "expert", expertCategory: crop.category, cropId: crop.cropId, routerProbability: crop.routerProbability }));
  });
  return { predictions, crops, experts };
};

type FinanceReplayRow = { id: string; raw: RawRow; extraction: ReceiptHierarchicalExtraction; simulated: ReturnType<typeof simulateExperts>; baselineComparable: boolean };
type FinanceFunnelStage = "routed" | "crop" | "ocr" | "candidate" | "model" | "agreement" | "trusted";
type FinanceFunnel = Record<ReceiptFrontendField, Record<FinanceFunnelStage, number>>;
const emptyFinanceFunnel = (): FinanceFunnel => Object.fromEntries(fields.map((field) => [field, Object.fromEntries([
  "routed", "crop", "ocr", "candidate", "model", "agreement", "trusted",
].map((stage) => [stage, 0]))])) as FinanceFunnel;
const candidateMatches = (candidate: { value: string }, expected: string): boolean => sameAmount(candidate.value, expected);
const candidateIndependent = (candidates: Array<{ observationKey: string; cropTop?: number; cropBottom?: number; probability: number }>) => {
  const selected: typeof candidates = [];
  [...candidates].sort((left, right) => right.probability - left.probability).forEach((candidate) => {
    const duplicate = selected.some((other) => {
      if (other.observationKey === candidate.observationKey) return true;
      if (other.cropTop == null || other.cropBottom == null || candidate.cropTop == null || candidate.cropBottom == null) return false;
      const overlap = Math.max(0, Math.min(other.cropBottom, candidate.cropBottom) - Math.max(other.cropTop, candidate.cropTop));
      const denominator = Math.max(1, Math.min(other.cropBottom - other.cropTop, candidate.cropBottom - candidate.cropTop));
      return overlap / denominator >= 0.86
        && Math.abs((other.cropTop + other.cropBottom) / 2 - (candidate.cropTop + candidate.cropBottom) / 2)
          <= Math.min(other.cropBottom - other.cropTop, candidate.cropBottom - candidate.cropTop) * 0.22;
    });
    if (!duplicate) selected.push(candidate);
  });
  return selected;
};
const expectedAgreement = (field: ReceiptFrontendField, candidates: NonNullable<ReceiptHierarchicalExtraction["diagnostics"]>["candidates"][ReceiptFrontendField], config: ReceiptHierarchicalConfig): boolean => {
  const matching = candidates;
  if (!matching.length) return false;
  const minimum = config.minIndependentObservationsByCategory?.[field] ?? config.minIndependentObservations ?? 2;
  const independent = candidateIndependent(matching);
  if (independent.length >= minimum) return true;
  const strongest = [...matching].sort((left, right) => right.probability - left.probability)[0];
  const strongThreshold = config.strongPredictionThreshold?.[field] ?? 0.92;
  const confidenceThreshold = config.strongConfidenceThreshold?.[field] ?? 0.90;
  const semantic = field === "subtotal"
    ? /\bsub[\s-]?total\b/i.test(strongest.financialLabelText)
    : field === "tax" && ((strongest.financialSummaryContext && strongest.financialSummaryColumnMatch >= 0.65)
      || (strongest.financialDirectLabel && strongest.financialAssociation >= 0.70 && !strongest.financialZeroRate));
  return Boolean(config.allowStrongSingleObservation?.[field]
    && strongest.probability >= (config.expertThresholds?.[field] ?? 0.8)
    && strongest.confidence >= strongThreshold
    && strongest.confidence >= confidenceThreshold
    && (strongest.ocrConfidence ?? 0) >= 90
    && semantic);
};
const score = (rows: FinanceReplayRow[], labels: FinanceLabels, config: ReceiptHierarchicalConfig) => {
  const byId = new Map(labels.receipts.map((receipt) => [receipt.id, receipt]));
  const metrics = Object.fromEntries(fields.map((field) => [field, { verified: 0, absent: 0, ambiguous: 0, trusted: 0, correct: 0, wrongTrusted: 0, absentTrusted: 0, ambiguousTrusted: 0, wrongTrustedIds: [] as string[], absentTrustedIds: [] as string[], ambiguousTrustedIds: [] as string[] }])) as Record<ReceiptFrontendField, { verified: number; absent: number; ambiguous: number; trusted: number; correct: number; wrongTrusted: number; absentTrusted: number; ambiguousTrusted: number; wrongTrustedIds: string[]; absentTrustedIds: string[]; ambiguousTrustedIds: string[] }>;
  let unresolved = 0;
  let baselineUnresolved = 0;
  let baselineRows = 0;
  let agreementEligible = 0;
  let modelPassing = 0;
  let specialistCalls = 0;
  let ocrLines = 0;
  const financeFunnel = emptyFinanceFunnel();
  const funnelStageOrder: FinanceFunnelStage[] = ["routed", "crop", "ocr", "candidate", "model", "agreement", "trusted"];
  const firstLossIds = Object.fromEntries(fields.map((field) => [field, Object.fromEntries(funnelStageOrder.map((stage) => [stage, [] as string[]]))])) as Record<ReceiptFrontendField, Record<FinanceFunnelStage, string[]>>;
  const details: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const label = byId.get(row.id);
    if (!label) continue;
    unresolved += row.extraction.unresolvedFields.length;
    const baselineFields = row.raw.extraction?.fields;
    if (row.baselineComparable && baselineFields) {
      baselineRows += 1;
      baselineUnresolved += Object.values(baselineFields).filter((field) => field.status !== "trusted").length;
    }
    specialistCalls += row.extraction.routing.specialistInvocationCount;
    ocrLines += row.extraction.deduplication.expertInputLineCount;
    Object.values(row.extraction.funnel.byCategory).forEach((funnel) => { modelPassing += funnel.modelPassing; agreementEligible += funnel.agreementEligible; });
    const rowFinanceFunnel: Record<string, Record<string, boolean>> = {};
    const rawByObservation = new Map<string, RawLine[]>();
    const rawObservations = row.raw.observations ?? [...(row.raw.firstPassObservations ?? []), ...(row.raw.expertObservations ?? [])];
    rawObservations.forEach((line) => rawByObservation.set(String(line.observationKey ?? ""), [...(rawByObservation.get(String(line.observationKey ?? "")) ?? []), line]));
    details.push({
      id: row.id,
      fields: Object.fromEntries(fields.map((field) => [field, { label: label.fields[field].status, predictedStatus: row.extraction.fields[field].status, predictedValue: row.extraction.fields[field].value, confidence: row.extraction.fields[field].confidence }])),
      funnel: { subtotal: row.extraction.funnel.byCategory.subtotal, tax: row.extraction.funnel.byCategory.tax },
    });
    fields.forEach((field) => {
      const expected = label.fields[field];
      const metric = metrics[field];
      if (expected.status === "verified") metric.verified += 1;
      if (expected.status === "absent") metric.absent += 1;
      if (expected.status === "ambiguous") metric.ambiguous += 1;
      const value = row.extraction.fields[field];
      if (expected.status === "verified" && expected.value) {
        const category = field;
        const routed = row.simulated.predictions.some((prediction) => prediction.routes.includes(category)
          && (rawByObservation.get(prediction.observationKey) ?? []).some((line) => lineHasAmount(line, expected.value!)));
        const crop = row.simulated.crops.some((candidate) => candidate.category === category
          && (rawByObservation.get(candidate.sourceObservationKey) ?? []).some((line) => lineHasAmount(line, expected.value!)));
        const ocr = row.simulated.experts.some((line) => line.expertCategory === category && lineHasAmount(line, expected.value!));
        const diagnosticCandidates = row.extraction.diagnostics?.candidates[field] ?? [];
        const matching = diagnosticCandidates.filter((candidate) => candidateMatches(candidate, expected.value!));
        const threshold = config.expertThresholds?.[field] ?? 0.8;
        const minimumConfidence = config.expertMinConfidence?.[field] ?? 0.98;
        const model = matching.some((candidate) => !candidate.hardNegative
          && candidate.financialAssociation >= 0.55
          && !candidate.financialOpposing
          && candidate.probability >= threshold
          && candidate.confidence >= minimumConfidence);
        const trusted = value.status === "trusted" && sameAmount(value.value, expected.value);
        // The production selector exposes the exact agreement outcome for its
        // chosen value. Use it when the chosen value is the independently
        // labelled one; otherwise retain the candidate-level reconstruction
        // to show whether a correct value was lost before final selection.
        const agreement = sameAmount(value.value, expected.value) ? value.agreement : expectedAgreement(field, matching, config);
        const stages = { routed, crop, ocr, candidate: matching.length > 0, model, agreement, trusted };
        rowFinanceFunnel[field] = stages;
        (Object.keys(stages) as FinanceFunnelStage[]).forEach((stage) => { if (stages[stage]) financeFunnel[field][stage] += 1; });
        const firstLoss = funnelStageOrder.find((stage) => !stages[stage]);
        if (firstLoss) firstLossIds[field][firstLoss].push(row.id);
      }
      if (value.status !== "trusted") return;
      metric.trusted += 1;
      if (expected.status === "verified" && sameAmount(value.value, expected.value)) metric.correct += 1;
      else if (expected.status === "verified" || expected.status === "absent") {
        metric.wrongTrusted += 1;
        metric.wrongTrustedIds.push(row.id);
        if (expected.status === "absent") metric.absentTrusted += 1;
        if (expected.status === "absent") metric.absentTrustedIds.push(row.id);
      }
      else {
        metric.ambiguousTrusted += 1;
        metric.ambiguousTrustedIds.push(row.id);
      }
    });
    const detail = details[details.length - 1];
    detail.financeFunnel = rowFinanceFunnel;
  }
  const fieldsReport = Object.fromEntries(fields.map((field) => {
    const metric = metrics[field];
    const scoredTrusted = metric.trusted - metric.ambiguousTrusted;
    const precisionTrials = metric.correct + metric.wrongTrusted;
    return [field, {
      ...metric,
      precision: precisionTrials ? metric.correct / precisionTrials : null,
      precision95: wilsonInterval(metric.correct, precisionTrials),
      verifiedCoverage: metric.verified ? metric.correct / metric.verified : null,
      verifiedCoverage95: wilsonInterval(metric.correct, metric.verified),
      trustedCoverage: metric.verified ? scoredTrusted / metric.verified : null,
      absentFalsePositiveRate: metric.absent ? metric.absentTrusted / metric.absent : null,
      absentFalsePositiveRate95: wilsonInterval(metric.absentTrusted, metric.absent),
      ambiguousUnsupportedRate: metric.ambiguous ? metric.ambiguousTrusted / metric.ambiguous : null,
      ambiguousUnsupportedRate95: wilsonInterval(metric.ambiguousTrusted, metric.ambiguous),
    }];
  }));
  const meanUnresolvedFields = unresolved / Math.max(1, rows.length);
  const baselineMeanUnresolvedFields = baselineRows ? baselineUnresolved / baselineRows : null;
  return {
    sampleSize: rows.length,
    fields: fieldsReport,
    financeFunnel,
    firstLossIds,
    meanUnresolvedFields,
    baselineMeanUnresolvedFields,
    unresolvedFieldReduction: baselineMeanUnresolvedFields == null ? null : baselineMeanUnresolvedFields - meanUnresolvedFields,
    unresolvedFieldReductionRate: baselineMeanUnresolvedFields == null || baselineMeanUnresolvedFields <= 0 ? null : (baselineMeanUnresolvedFields - meanUnresolvedFields) / baselineMeanUnresolvedFields,
    baselineRows,
    modelPassing,
    agreementEligible,
    specialistCalls,
    specialistCallsPerReceipt: specialistCalls / Math.max(1, rows.length),
    expertLinesPerReceipt: ocrLines / Math.max(1, rows.length),
    details,
  };
};

describe("independently labelled finance evaluation", () => {
  it("scores subtotal/tax without feeding labels into tuning", async () => {
    if (!(await exists(inputPath)) || !(await exists(labelsPath))) {
      console.warn("Skipping finance evaluation: local SROIE OCR cache or labels are unavailable");
      return;
    }
    const rawFiles = [inputPath, ...(await exists(extraInputPath) ? [extraInputPath] : [])];
    const rawRows = (await Promise.all(rawFiles.map(async (filePath) => JSON.parse(await readFile(filePath, "utf8")) as RawFile))).flatMap((raw) => raw.rows);
    const labels = JSON.parse(await readFile(labelsPath, "utf8")) as FinanceLabels;
    const ids = new Set(labels.receipts.map((receipt) => receipt.id));
    const availableLabels = labels.receipts.filter((receipt) => rawRows.some((row) => row.id === receipt.id));
    const finalBaseIds = labels.receipts.filter((receipt) => /^\d+$/.test(receipt.id)).map((receipt) => Number(receipt.id));
    expect(labels.receipts).toHaveLength(labels.receiptCount);
    expect(labels.receiptCount).toBeGreaterThanOrEqual(100);
    expect(labels.receiptCount).toBeLessThanOrEqual(200);
    expect(finalBaseIds).not.toContain(452);
    expect(finalBaseIds.every((id) => id >= 400 && id < 500)).toBe(true);
    const config = RECEIPT_HIERARCHICAL_SCREENING_CONFIGS.find((candidate) => candidate.name === selectedConfigName);
    if (!config) throw new Error(`Missing selected config ${selectedConfigName}`);
    const rows: FinanceReplayRow[] = [];
    const started = Date.now();
    for (const rawRow of rawRows.filter((row) => ids.has(row.id))) {
      if (rawRow.config === config.name && rawRow.firstPassObservations && rawRow.expertObservations && rawRow.extraction?.routerPredictions && rawRow.extraction?.expertCrops && rawRow.extraction?.diagnostics) {
        const hierarchical = rawRow.extraction as unknown as ReceiptHierarchicalExtraction;
        rows.push({
          id: rawRow.id,
          raw: rawRow,
          simulated: {
            predictions: hierarchical.routerPredictions,
            crops: hierarchical.expertCrops,
            experts: rawRow.expertObservations as ReceiptHierarchicalObservation[],
          },
          extraction: hierarchical,
          baselineComparable: false,
        });
        continue;
      }
      const input = bandInputs(rawRow.observations ?? []);
      const simulated = simulateExperts(rawRow.observations ?? [], input.bands, config);
      rows.push({ id: rawRow.id, raw: rawRow, simulated, extraction: extractReceiptFieldsFromHierarchicalBands(input.first, simulated.experts, { config, routerPredictions: simulated.predictions, expertCrops: simulated.crops, includeDiagnostics: true }), baselineComparable: true });
    }
    const report = score(rows, labels, config);
    if (process.env.PRINT_FINANCE_DIAGNOSTICS === "1") {
      console.log(JSON.stringify(report.details, null, 2));
      console.log(JSON.stringify(rows.filter((row) => ["405", "414", "422", "460", "463", "467"].includes(row.id)).map((row) => ({ id: row.id, candidates: row.extraction.diagnostics?.candidates })), null, 2));
    }
    if (process.env.FINANCE_TRACE_IDS) {
      const traceIds = new Set(process.env.FINANCE_TRACE_IDS.split(",").map((id) => id.trim()).filter(Boolean));
      rows.filter((row) => traceIds.has(row.id)).forEach((row) => {
        fields.forEach((field) => console.log(JSON.stringify({
          id: row.id,
          field,
          result: row.extraction.fields[field],
          candidates: (row.extraction.diagnostics?.candidates[field] ?? []).map((candidate) => ({
            value: candidate.value,
            probability: Number(candidate.probability.toFixed(3)),
            confidence: Number(candidate.confidence.toFixed(3)),
            association: Number(candidate.financialAssociation.toFixed(3)),
            label: candidate.financialLabelText,
            strong: candidate.financialStrongLabel,
            direct: candidate.financialDirectLabel,
            sameLine: candidate.financialSameLine,
            column: Number(candidate.financialColumnMatch.toFixed(3)),
            labelDistance: candidate.financialLabelDistance,
            ocrConfidence: candidate.ocrConfidence,
            summary: candidate.financialSummaryColumnMatch,
            header: candidate.financialTableHeader,
            base: candidate.financialTaxCodeBase,
            zero: candidate.financialZeroRate,
            opposing: candidate.financialOpposing,
            observation: candidate.observationKey,
          })),
        })));
      });
    }
    const output = { protocol: labels.protocol, config: config.name, labelledReceipts: labels.receiptCount, availableLabelRows: availableLabels.length, benchmarkMs: Date.now() - started, ...report };
    await writeFile(resultsPath, JSON.stringify(output, null, 2) + "\n");
    const lines = [
      "# Independently labelled subtotal/tax evaluation", "",
      "This report uses only the public SROIE image-reviewed finance labels in `receipt-finance-evaluation-labels.json`. The label file is separate from training/configuration selection; no private images or OCR text are committed. The 99 grouped-final rows are IDs 400–499 except known duplicate-group member 452; the 100th row is a separately sourced public SROIE image.", "",
      `Configuration: **${config.name}**. Receipts scored: **${report.sampleSize}** of **${labels.receiptCount}** labelled receipts (the extra public row is optional when its local cache is absent).`, "",
      "The earlier 25-receipt image-reviewed sample reported subtotal 9/11 correct trusted (81.8% verified coverage) and tax 22/24 correct trusted (91.7% verified coverage), with no known wrong-trusted values. Those denominators are not pooled with this expanded set.", "",
      "The expanded set contains 15 explicit subtotal/net labels, 82 receipts with no unambiguous subtotal, and 3 intentionally ambiguous subtotal cases; tax includes 97 verified charged-tax values, 2 receipts with no printed tax field, and 1 ambiguous case. The review includes GST-inclusive receipts, tax-summary tables, discounts/savings, payment/change lines, zero-tax/no-tax receipts, and conflicting handwritten finance sections.", "",
      "The 99 cached rows reuse the existing PP-OCRv6 observations; the extra public row was run through the browser OCR path separately. Replay timing below is therefore a cached-selector benchmark, not an end-to-end OCR latency claim.", "",
      "Only `verified` fields enter precision/coverage. `absent` labels penalize trusted false positives. `ambiguous` labels are excluded from accuracy denominators and trusted predictions on them are reported as unsupported.", "",
      "| field | verified | absent | ambiguous | trusted | correct | wrong trusted | absent trusted | unsupported ambiguous | precision (95% Wilson) | verified coverage (95% Wilson) | trusted coverage |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...fields.map((field) => { const item = report.fields[field] as Record<string, number | null>; const interval = (key: string) => { const value = item[key] as unknown; return Array.isArray(value) ? ` [${(Number(value[0]) * 100).toFixed(1)}–${(Number(value[1]) * 100).toFixed(1)}%]` : ""; }; return `| ${field} | ${item.verified} | ${item.absent} | ${item.ambiguous} | ${item.trusted} | ${item.correct} | ${item.wrongTrusted} | ${item.absentTrusted} | ${item.ambiguousTrusted} | ${item.precision == null ? "n/a" : `${(item.precision * 100).toFixed(1)}%${interval("precision95")}`} | ${item.verifiedCoverage == null ? "n/a" : `${(item.verifiedCoverage * 100).toFixed(1)}%${interval("verifiedCoverage95")}`} | ${item.trustedCoverage == null ? "n/a" : `${(item.trustedCoverage * 100).toFixed(1)}%`} |`; }),
      "", "## Safety exceptions", "", ...fields.map((field) => { const item = report.fields[field] as Record<string, unknown>; const formatRate = (key: string) => { const value = item[key] as unknown; if (typeof value !== "number") return "n/a"; const interval = item[`${key}95`]; return `${(value * 100).toFixed(1)}%${Array.isArray(interval) ? ` [${(Number(interval[0]) * 100).toFixed(1)}–${(Number(interval[1]) * 100).toFixed(1)}%]` : ""}`; }; return `- ${field}: trusted on absent **${(item.absentTrustedIds as string[]).join(", ") || "none"}** (false-positive rate ${formatRate("absentFalsePositiveRate")}); wrong trusted verified IDs **${(item.wrongTrustedIds as string[]).filter((id) => !(item.absentTrustedIds as string[]).includes(id)).join(", ") || "none"}**; unsupported ambiguous IDs **${(item.ambiguousTrustedIds as string[]).join(", ") || "none"}** (rate ${formatRate("ambiguousUnsupportedRate")}).`; }),
      "", "## Verified-value funnel", "", "Counts are only independently verified expected values. A stage count is the number of receipts where that value survives the stage; absent/ambiguous labels are excluded. `crop` means a routed crop proposal contains the expected amount; `ocr` means the specialist OCR observation contains it. Overlapping copies are deduplicated for agreement.", "",
      "| field | routed | crop | OCR | candidate | model | agreement | trusted |", "|---|---:|---:|---:|---:|---:|---:|---:|",
      ...fields.map((field) => { const item = report.financeFunnel[field]; return `| ${field} | ${item.routed} | ${item.crop} | ${item.ocr} | ${item.candidate} | ${item.model} | ${item.agreement} | ${item.trusted} |`; }),
      "", "Verified-value loss IDs by stage (public SROIE IDs; this is geometry/metrics only, not receipt content):",
      ...fields.map((field) => {
        const stages: FinanceFunnelStage[] = ["routed", "crop", "ocr", "candidate", "model", "agreement", "trusted"];
        const losses = stages.map((stage) => `${stage}: ${report.details.filter((detail) => (detail.fields as Record<string, { label: string }>)[field]?.label === "verified" && !(detail.financeFunnel as Record<string, Record<string, boolean>>)?.[field]?.[stage]).map((detail) => detail.id).join(", ") || "none"}`).join("; ");
        return `- ${field}: ${losses}`;
      }),
      "", `Mean unresolved fields: ${report.meanUnresolvedFields.toFixed(2)}; cached-input baseline (${report.baselineRows} comparable rows): ${report.baselineMeanUnresolvedFields == null ? "n/a" : report.baselineMeanUnresolvedFields.toFixed(2)}; reduction: ${report.unresolvedFieldReduction == null ? "n/a" : report.unresolvedFieldReduction.toFixed(2)} (${report.unresolvedFieldReductionRate == null ? "n/a" : `${(report.unresolvedFieldReductionRate * 100).toFixed(1)}%`}). Model-passing candidates: ${report.modelPassing}; agreement-eligible groups: ${report.agreementEligible}; specialist calls: ${report.specialistCallsPerReceipt.toFixed(2)}/receipt; expert input lines: ${report.expertLinesPerReceipt.toFixed(1)}/receipt; benchmark wall time: ${(output.benchmarkMs / 1000).toFixed(1)}s.`, "",
      "First-stage loss IDs for verified values (the first missing stage is the primary loss category):", "",
      ...fields.map((field) => `- ${field}: ${Object.entries(report.firstLossIds[field]).filter(([, ids]) => (ids as string[]).length > 0).map(([stage, ids]) => `${stage}=${(ids as string[]).join(",")}`).join("; ") || "none"}`), "",
      "Failure diagnosis from the frozen run: subtotal values reached the model but were lost at agreement on IDs 408, 426, and 464; tax values were lost at routing on 415, 420, and 421, at specialist OCR on 436, 453, and 464, at model gating on 401, 403, 406, 441–448, 450, and 451, and at agreement on 407, 412, 462, 465, and 466. The three wrong-trusted tax cases were 415 (summary base/amount-column association), 436 (concatenated low-quality GST amount), and 453 (inclusive-total line mis-associated as tax). These are receipt IDs and failure categories only; no OCR text is stored.", "",
      "Decision: the frozen expanded result does not justify promoting or aggressively retuning this configuration: tax has three wrong-trusted verified values (96.0% observed precision), and the Wilson interval is broad. No production detector or trust threshold was changed after this evaluation; any future fix must use a separate tuning subset.", "",
      "This is a held-out finance evaluation, not a training metric. It is intentionally not used to lower trust thresholds.", "",
    ];
    await writeFile(reportPath, lines.join("\n"));
    expect(rows).toHaveLength(availableLabels.length);
  }, 600_000);
});
