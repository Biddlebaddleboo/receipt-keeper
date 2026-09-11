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
const labelsPath = path.join(root, "benchmarks/receipt-finance-evaluation-labels.json");
const reportPath = path.join(root, "benchmarks/receipt-finance-evaluation-report.md");
const resultsPath = path.join(root, "benchmarks/receipt-finance-evaluation-results.json");
const fields: readonly ReceiptFrontendField[] = ["subtotal", "tax"];
const selectedConfigName = "specialist-finance-high-recall-calibrated-single";

type RawLine = { text: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number }; polygon?: Array<[number, number]>; bandIndex?: number; bandTop?: number; bandBottom?: number; observationKey?: string };
type RawRow = { id: string; observations?: RawLine[]; extraction?: { fields?: ReceiptFrontendFields }; [key: string]: unknown };
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

type FinanceReplayRow = { id: string; raw: RawRow; extraction: ReceiptHierarchicalExtraction; simulated: ReturnType<typeof simulateExperts> };
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
  const metrics = Object.fromEntries(fields.map((field) => [field, { verified: 0, absent: 0, ambiguous: 0, trusted: 0, correct: 0, wrongTrusted: 0, ambiguousTrusted: 0 }])) as Record<ReceiptFrontendField, { verified: number; absent: number; ambiguous: number; trusted: number; correct: number; wrongTrusted: number; ambiguousTrusted: number }>;
  let unresolved = 0;
  let agreementEligible = 0;
  let modelPassing = 0;
  let specialistCalls = 0;
  let ocrLines = 0;
  const financeFunnel = emptyFinanceFunnel();
  const details: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const label = byId.get(row.id);
    if (!label) continue;
    unresolved += row.extraction.unresolvedFields.length;
    specialistCalls += row.extraction.routing.specialistInvocationCount;
    ocrLines += row.extraction.deduplication.expertInputLineCount;
    Object.values(row.extraction.funnel.byCategory).forEach((funnel) => { modelPassing += funnel.modelPassing; agreementEligible += funnel.agreementEligible; });
    const rowFinanceFunnel: Record<string, Record<string, boolean>> = {};
    const rawByObservation = new Map<string, RawLine[]>();
    (row.raw.observations ?? []).forEach((line) => rawByObservation.set(String(line.observationKey ?? ""), [...(rawByObservation.get(String(line.observationKey ?? "")) ?? []), line]));
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
      }
      if (value.status !== "trusted") return;
      metric.trusted += 1;
      if (expected.status === "verified" && sameAmount(value.value, expected.value)) metric.correct += 1;
      else if (expected.status === "verified" || expected.status === "absent") metric.wrongTrusted += 1;
      else metric.ambiguousTrusted += 1;
    });
    const detail = details[details.length - 1];
    detail.financeFunnel = rowFinanceFunnel;
  }
  const fieldsReport = Object.fromEntries(fields.map((field) => {
    const metric = metrics[field];
    const scoredTrusted = metric.trusted - metric.ambiguousTrusted;
    return [field, { ...metric, precision: scoredTrusted ? metric.correct / Math.max(1, metric.correct + metric.wrongTrusted) : null, verifiedCoverage: metric.verified ? metric.correct / metric.verified : null, trustedCoverage: metric.verified ? scoredTrusted / metric.verified : null }];
  }));
  return { sampleSize: rows.length, fields: fieldsReport, financeFunnel, meanUnresolvedFields: unresolved / Math.max(1, rows.length), modelPassing, agreementEligible, specialistCalls, specialistCallsPerReceipt: specialistCalls / Math.max(1, rows.length), expertLinesPerReceipt: ocrLines / Math.max(1, rows.length), details };
};

describe("independently labelled finance evaluation", () => {
  it("scores subtotal/tax without feeding labels into tuning", async () => {
    if (!(await exists(inputPath)) || !(await exists(labelsPath))) {
      console.warn("Skipping finance evaluation: local SROIE OCR cache or labels are unavailable");
      return;
    }
    const raw = JSON.parse(await readFile(inputPath, "utf8")) as RawFile;
    const labels = JSON.parse(await readFile(labelsPath, "utf8")) as FinanceLabels;
    const ids = new Set(labels.receipts.map((receipt) => receipt.id));
    const config = RECEIPT_HIERARCHICAL_SCREENING_CONFIGS.find((candidate) => candidate.name === selectedConfigName);
    if (!config) throw new Error(`Missing selected config ${selectedConfigName}`);
    const rows: FinanceReplayRow[] = [];
    const started = Date.now();
    for (const rawRow of raw.rows.filter((row) => ids.has(row.id))) {
      const input = bandInputs(rawRow.observations ?? []);
      const simulated = simulateExperts(rawRow.observations ?? [], input.bands, config);
      rows.push({ id: rawRow.id, raw: rawRow, simulated, extraction: extractReceiptFieldsFromHierarchicalBands(input.first, simulated.experts, { config, routerPredictions: simulated.predictions, expertCrops: simulated.crops, includeDiagnostics: true }) });
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
    const output = { protocol: labels.protocol, config: config.name, benchmarkMs: Date.now() - started, ...report };
    await writeFile(resultsPath, JSON.stringify(output, null, 2) + "\n");
    const lines = [
      "# Independently labelled subtotal/tax evaluation", "",
      "This report uses only the public SROIE image-reviewed finance labels in `receipt-finance-evaluation-labels.json`. The label file is separate from training/configuration selection; no private images or OCR text are committed.", "",
      `Configuration: **${config.name}**. Receipts scored: **${report.sampleSize}**.`, "",
      "Only `verified` fields enter precision/coverage. `absent` labels penalize trusted false positives. `ambiguous` labels are excluded from accuracy denominators and trusted predictions on them are reported as unsupported.", "",
      "| field | verified | absent | ambiguous | trusted | correct | wrong trusted | unsupported ambiguous | precision | verified coverage | trusted coverage |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...fields.map((field) => { const item = report.fields[field] as Record<string, number | null>; return `| ${field} | ${item.verified} | ${item.absent} | ${item.ambiguous} | ${item.trusted} | ${item.correct} | ${item.wrongTrusted} | ${item.ambiguousTrusted} | ${item.precision == null ? "n/a" : `${(item.precision * 100).toFixed(1)}%`} | ${item.verifiedCoverage == null ? "n/a" : `${(item.verifiedCoverage * 100).toFixed(1)}%`} | ${item.trustedCoverage == null ? "n/a" : `${(item.trustedCoverage * 100).toFixed(1)}%`} |`; }),
      "", "## Verified-value funnel", "", "Counts are only independently verified expected values. A stage count is the number of receipts where that value survives the stage; absent/ambiguous labels are excluded. `crop` means a routed crop proposal contains the expected amount; `ocr` means the specialist OCR observation contains it. Overlapping copies are deduplicated for agreement.", "",
      "| field | routed | crop | OCR | candidate | model | agreement | trusted |", "|---|---:|---:|---:|---:|---:|---:|---:|",
      ...fields.map((field) => { const item = report.financeFunnel[field]; return `| ${field} | ${item.routed} | ${item.crop} | ${item.ocr} | ${item.candidate} | ${item.model} | ${item.agreement} | ${item.trusted} |`; }),
      "", "Verified-value loss IDs by stage (public SROIE IDs; this is geometry/metrics only, not receipt content):",
      ...fields.map((field) => {
        const stages: FinanceFunnelStage[] = ["routed", "crop", "ocr", "candidate", "model", "agreement", "trusted"];
        const losses = stages.map((stage) => `${stage}: ${report.details.filter((detail) => (detail.fields as Record<string, { label: string }>)[field]?.label === "verified" && !(detail.financeFunnel as Record<string, Record<string, boolean>>)?.[field]?.[stage]).map((detail) => detail.id).join(", ") || "none"}`).join("; ");
        return `- ${field}: ${losses}`;
      }),
      "", `Mean unresolved fields: ${report.meanUnresolvedFields.toFixed(2)}. Model-passing candidates: ${report.modelPassing}; agreement-eligible groups: ${report.agreementEligible}; specialist calls: ${report.specialistCallsPerReceipt.toFixed(2)}/receipt; expert input lines: ${report.expertLinesPerReceipt.toFixed(1)}/receipt; benchmark wall time: ${(output.benchmarkMs / 1000).toFixed(1)}s.`, "",
      "This is a held-out finance evaluation, not a training metric. It is intentionally not used to lower trust thresholds.", "",
    ];
    await writeFile(reportPath, lines.join("\n"));
    expect(rows).toHaveLength(labels.receiptCount);
  }, 600_000);
});
