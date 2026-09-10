import { normalizeReceiptPurchaseDate } from "@/lib/receiptDate";
import { RECEIPT_OCR_LIVE_STRATEGY, recognizeReceiptOcrPass, type ReceiptOcrLine } from "@/lib/receiptOcr";
import fieldModelJson from "@/lib/receiptFieldModel.json";

export { receiptOcrLinesFromTesseractData } from "@/lib/receiptOcr";
export type { ReceiptOcrLine } from "@/lib/receiptOcr";

export const RECEIPT_FRONTEND_FIELDS = ["vendor", "purchase_date", "subtotal", "tax", "total"] as const;
export type ReceiptFrontendField = (typeof RECEIPT_FRONTEND_FIELDS)[number];
export type ReceiptFrontendFieldSource = "browser-ocr" | "rule" | "ml" | "manual";
export type ReceiptFrontendFieldStatus = "trusted" | "uncertain" | "missing";

export interface ReceiptFrontendFieldResult {
  value: string | null;
  confidence: number;
  status: ReceiptFrontendFieldStatus;
  source: ReceiptFrontendFieldSource;
  evidence: string;
}

export type ReceiptFrontendFields = Record<ReceiptFrontendField, ReceiptFrontendFieldResult>;

export interface ReceiptFrontendExtraction {
  text: string;
  fields: ReceiptFrontendFields;
  unresolvedFields: ReceiptFrontendField[];
  durationMs: number;
  engine: "tesseract.js" | "ppocrv6" | "ppocrv6-bands" | "unavailable" | "rules-only";
  ocrLines?: ReceiptOcrLine[];
}

interface FieldModel {
  type: "logistic";
  weights: number[];
  threshold: number;
  min_margin: number;
  calibration: Array<{ max: number; accuracy: number }>;
}

interface ReceiptFieldModel {
  version: number;
  feature_names: string[];
  fields: Record<ReceiptFrontendField, FieldModel>;
}

const fieldModel = fieldModelJson as ReceiptFieldModel;

export interface ReceiptFrontendDecision {
  mode: "remaining" | "entire" | "none";
  fields: Partial<Record<ReceiptFrontendField, ReceiptFrontendFieldResult>>;
  unresolvedFields: ReceiptFrontendField[];
  ocrText: string;
}

const TRUST_THRESHOLD = 0.92;

const emptyField = (): ReceiptFrontendFieldResult => ({
  value: null,
  confidence: 0,
  status: "missing",
  source: "rule",
  evidence: "",
});

const normalizeLine = (line: string): string => line.replace(/[|¦]/g, " ").replace(/\s+/g, " ").trim();

const linesFromText = (text: string): string[] => text
  .split(/\r?\n/)
  .map(normalizeLine)
  .filter((line) => line.length > 0);

const amountPattern = /(?:[$€£]\s*)?\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?/g;
const datePattern = /\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:20)?\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)20\d{2})\b/gi;

const featureKeywords = [
  "total", "grand", "due", "payable", "after", "adj", "adjustment", "incl", "inclusive",
  "excl", "excluding", "sales", "summary", "tax", "gst", "subtotal", "sub-total", "rounding",
  "round", "cash", "change", "tender", "paid", "payment", "qty", "quantity", "item", "price",
  "discount", "amount", "final", "balance", "before", "invoice", "date", "time", "issued", "store",
  "receipt", "member", "address", "thank",
] as const;

const fieldLabelPatterns: Record<ReceiptFrontendField, RegExp> = {
  vendor: /never-match/i,
  purchase_date: /\b(?:date|time|issued|invoice)\b/i,
  subtotal: /\b(?:sub[ -]?total|before tax)\b/i,
  tax: /\b(?:tax|gst|hst|vat|sales tax)\b/i,
  total: /\b(?:total|amount due|balance due|payable)\b/i,
};

const hasKeyword = (text: string, keyword: string): number => {
  if (keyword.includes("-")) return text.toLowerCase().includes(keyword) ? 1 : 0;
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(text) ? 1 : 0;
};

const normalizedOcrLines = (ocrLines: ReceiptOcrLine[]): Array<ReceiptOcrLine & {
  normalized: string;
  x: number;
  y: number;
  width: number;
  height: number;
}> => {
  const lines = ocrLines
    .map((line) => ({ ...line, normalized: normalizeLine(line.text) }))
    .filter((line) => line.normalized.length > 0);
  const maxX = Math.max(1, ...lines.map((line) => line.bbox?.x1 ?? 0));
  const maxY = Math.max(1, ...lines.map((line) => line.bbox?.y1 ?? 0));
  return lines.map((line, index) => {
    const bbox = line.bbox ?? { x0: 0, y0: index, x1: 1, y1: index + 1 };
    return {
      ...line,
      x: Math.min(bbox.x0, bbox.x1) / maxX,
      y: Math.min(bbox.y0, bbox.y1) / maxY,
      width: Math.max(0, Math.max(bbox.x0, bbox.x1) - Math.min(bbox.x0, bbox.x1)) / maxX,
      height: Math.max(0, Math.max(bbox.y0, bbox.y1) - Math.min(bbox.y0, bbox.y1)) / maxY,
    };
  });
};

const modelFeatures = (
  lines: ReturnType<typeof normalizedOcrLines>,
  index: number,
  field: ReceiptFrontendField,
  rawAmount?: string,
): number[] => {
  const line = lines[index];
  const text = line.normalized;
  const previous = index > 0 ? lines[index - 1].normalized : "";
  const next = index + 1 < lines.length ? lines[index + 1].normalized : "";
  amountPattern.lastIndex = 0;
  const amounts = text.match(amountPattern) ?? [];
  amountPattern.lastIndex = 0;
  const values = [
    line.y, line.x, line.width, line.height,
    index === 0 ? 1 : 0, index === lines.length - 1 ? 1 : 0,
    line.y < 0.22 ? 1 : 0, line.y > 0.78 ? 1 : 0,
    Math.min(text.length, 80) / 80,
    (text.match(/[A-Za-z]/g) ?? []).length / Math.max(text.length, 1),
    (text.match(/[0-9]/g) ?? []).length / Math.max(text.length, 1),
    Math.min(amounts.length, 4) / 4, amounts.length > 0 ? 1 : 0,
    datePattern.test(text) ? 1 : 0,
    /[$€£]|\b(?:rm|usd|cad|gbp)\b/i.test(text) ? 1 : 0,
    Math.max(0, Math.min(1, line.confidence == null ? 0.8 : line.confidence / 100)),
    fieldLabelPatterns[field].test(text) ? 1 : 0,
    fieldLabelPatterns[field].test(previous) ? 1 : 0,
    fieldLabelPatterns[field].test(next) ? 1 : 0,
    hasAmount(previous) ? 1 : 0,
    hasAmount(next) ? 1 : 0,
    ...featureKeywords.map((keyword) => hasKeyword(text, keyword)),
    ...featureKeywords.map((keyword) => hasKeyword(previous, keyword)),
    ...featureKeywords.map((keyword) => hasKeyword(next, keyword)),
  ];
  datePattern.lastIndex = 0;
  amountPattern.lastIndex = 0;
  if (!rawAmount) values.push(0, 0);
  else {
    const position = Math.max(text.indexOf(rawAmount), 0);
    values.push(position / Math.max(text.length, 1), position >= text.length * 0.5 ? 1 : 0);
  }
  return values;
};

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));

const calibrateModelProbability = (raw: number, calibration: FieldModel["calibration"]): number => {
  const point = calibration.find((candidate) => raw < candidate.max) ?? calibration[calibration.length - 1];
  return Math.max(0, Math.min(1, point?.accuracy ?? raw));
};

export const parseReceiptAmount = (raw: string): number | null => {
  let value = raw.replace(/[\s$€£]/g, "").replace(/[()]/g, "");
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma > dot) value = value.replace(/\./g, "").replace(",", ".");
  else value = value.replace(/,/g, "");
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 1000000 ? parsed : null;
};

const moneyOnLine = (line: string): string | null => {
  const matches = line.match(amountPattern) ?? [];
  const valid = matches.filter((match) => parseReceiptAmount(match) !== null);
  return valid.length === 1 ? valid[0].replace(/\s+/g, "").replace(/[€£]/g, "$") : null;
};

const result = (
  value: string | null,
  confidence: number,
  evidence: string,
  source: ReceiptFrontendFieldSource = "rule",
): ReceiptFrontendFieldResult => ({
  value,
  confidence,
  status: value && confidence >= TRUST_THRESHOLD ? "trusted" : value ? "uncertain" : "missing",
  source,
  evidence,
});

const findLabeledAmount = (lines: string[], matcher: RegExp): ReceiptFrontendFieldResult => {
  const isTotalMatcher = matcher.source.includes("grand total");
  const candidates: Array<{ line: string; amount: string }> = [];
  lines.forEach((line, index) => {
    if (!matcher.test(line)
      || (/\bsub[ -]?total\b/i.test(line) && isTotalMatcher)
      || (isTotalMatcher && /\b(?:qty|quantity|items?|excluding|excl\.?|before|tax)\b/i.test(line))) return;
    const amount = moneyOnLine(line) ?? moneyOnLine(lines[index + 1] ?? "");
    if (amount) candidates.push({ line: amount === moneyOnLine(line) ? line : `${line} ${lines[index + 1]}`, amount });
  });
  const unique = Array.from(new Map(candidates.map((candidate) => [candidate.amount, candidate])).values());
  if (unique.length !== 1) return emptyField();
  return result(unique[0].amount, 0.97, unique[0].line);
};

const extractDate = (lines: string[]): ReceiptFrontendFieldResult => {
  const datePattern = /\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:20)?\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)20\d{2})\b/gi;
  const candidates = lines.flatMap((line) => [...line.matchAll(datePattern)].map((match) => ({ line, raw: match[0] })));
  if (candidates.length !== 1) return emptyField();
  const raw = candidates[0].raw;
  let normalized = normalizeReceiptPurchaseDate(raw);
  // Receipt printers commonly use DD/MM/YYYY. Accept it only when the day
  // cannot be mistaken for a month; ambiguous dates remain GPT work.
  const dmy = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})$/);
  const mdy = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2})$/);
  if (dmy && Number(dmy[1]) <= 12 && Number(dmy[2]) <= 12) return emptyField();
  if (!normalized && mdy && Number(mdy[2]) > 12) {
    normalized = `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  if (!normalized && dmy && Number(dmy[1]) > 12) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    normalized = `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return normalized ? result(normalized, 0.95, candidates[0].line) : emptyField();
};

const extractVendor = (lines: string[]): ReceiptFrontendFieldResult => {
  const blocked = /^(?:store|shop)$|\b(receipt|invoice|subtotal|sub-total|total|tax|gst|hst|date|cashier|address|tel|phone|thank|change|tender)\b/i;
  const candidates = lines.slice(0, 6).filter((line) => {
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    return letters >= 3 && letters / Math.max(line.length, 1) >= 0.45 && line.length <= 64 && !blocked.test(line) && !moneyOnLine(line);
  });
  if (candidates.length !== 1) return emptyField();
  const merchantSignature = /\b(?:walmart|costco|target|amazon|whole foods|safeway|loblaws|sobeys|home depot|lowe'?s|inc|ltd|llc|corp|co\.?|sdn|bhd|berhad|limited|market|mart|store)\b/i;
  return result(candidates[0], merchantSignature.test(candidates[0]) ? 0.96 : 0.9, candidates[0]);
};

const hasAmount = (text: string): boolean => {
  amountPattern.lastIndex = 0;
  const found = amountPattern.test(text);
  amountPattern.lastIndex = 0;
  return found;
};

const modelCandidateResult = (
  lines: ReturnType<typeof normalizedOcrLines>,
  field: ReceiptFrontendField,
): ReceiptFrontendFieldResult => {
  const configuration = fieldModel.fields[field];
  if (!configuration || configuration.type !== "logistic" || !configuration.weights.length) return emptyField();
  const candidates: Array<{ index: number; value: string; evidence: string; features: number[]; raw: number }> = [];
  const addCandidate = (index: number, value: string, rawAmount?: string) => {
    const features = modelFeatures(lines, index, field, rawAmount);
    const raw = sigmoid(configuration.weights[0] + configuration.weights.slice(1).reduce((sum, weight, position) => sum + weight * (features[position] ?? 0), 0));
    candidates.push({ index, value, evidence: lines[index].normalized, features, raw });
  };

  if (field === "vendor") {
    const blocked = /^(?:store|shop)$|\b(?:receipt|invoice|subtotal|sub-total|total|tax|gst|hst|date|cashier|address|tel|phone|thank|change|tender)\b/i;
    lines.slice(0, 12).forEach((line, index) => {
      const letters = (line.normalized.match(/[A-Za-z]/g) ?? []).length;
      if (letters >= 3 && letters / Math.max(line.normalized.length, 1) >= 0.35 && line.normalized.length <= 80 && !blocked.test(line.normalized) && !hasAmount(line.normalized)) addCandidate(index, line.normalized);
    });
  } else if (field === "purchase_date") {
    lines.forEach((line, index) => {
      datePattern.lastIndex = 0;
      const matches = [...line.normalized.matchAll(datePattern)];
      datePattern.lastIndex = 0;
      matches.forEach((match) => {
        const parsed = extractDate([match[0]]);
        if (parsed.value) addCandidate(index, parsed.value);
      });
    });
  } else {
    lines.forEach((line, index) => {
      amountPattern.lastIndex = 0;
      const amounts = line.normalized.match(amountPattern) ?? [];
      amountPattern.lastIndex = 0;
      amounts.forEach((rawAmount) => {
        if (parseReceiptAmount(rawAmount) !== null) addCandidate(index, rawAmount.replace(/[€£]/g, "$"), rawAmount);
      });
    });
  }
  if (!candidates.length) return emptyField();
  candidates.sort((left, right) => right.raw - left.raw);
  const top = candidates[0];
  const second = candidates[1]?.raw ?? 0;
  const margin = top.raw - second;
  const confidence = calibrateModelProbability(top.raw, configuration.calibration);
  const previousText = top.index > 0 ? lines[top.index - 1].normalized : "";
  const nextText = top.index + 1 < lines.length ? lines[top.index + 1].normalized : "";
  const fieldEvidence = field === "vendor"
    || fieldLabelPatterns[field].test(top.evidence)
    || fieldLabelPatterns[field].test(previousText)
    || fieldLabelPatterns[field].test(nextText);
  const uniqueLabeledAmounts = field === "subtotal" || field === "tax"
    ? new Set(lines.flatMap((line, index) => {
      const previousLine = index > 0 ? lines[index - 1].normalized : "";
      const nextLine = index + 1 < lines.length ? lines[index + 1].normalized : "";
      if (!fieldLabelPatterns[field].test(line.normalized)
        && !fieldLabelPatterns[field].test(previousLine)
        && !fieldLabelPatterns[field].test(nextLine)) return [];
      amountPattern.lastIndex = 0;
      const values = line.normalized.match(amountPattern) ?? [];
      amountPattern.lastIndex = 0;
      return values.map((value) => value.replace(/[€£]/g, "$"));
    })).size
    : 0;
  // SROIE has no independent subtotal/tax labels.  Never let a learned
  // ranking choose among multiple tax/subtotal amounts; the existing unique
  // labelled-value rule remains the only autonomous path for these fields.
  const uniqueWeaklySupervisedAmount = (field !== "subtotal" && field !== "tax") || uniqueLabeledAmounts === 1;
  const safe = top.raw >= configuration.threshold
    && confidence >= TRUST_THRESHOLD
    && margin >= configuration.min_margin
    && fieldEvidence
    && uniqueWeaklySupervisedAmount;
  const parsedValue = field === "vendor" ? top.value : field === "purchase_date" ? top.value : top.value;
  return {
    value: parsedValue,
    confidence,
    status: safe ? "trusted" : "uncertain",
    source: "ml",
    evidence: `${top.evidence} (model ${Math.round(confidence * 100)}%)`,
  };
};

const browserOcrFields = (fields: ReceiptFrontendFields): ReceiptFrontendFields => Object.fromEntries(
  RECEIPT_FRONTEND_FIELDS.map((field) => [field, {
    ...fields[field],
    source: fields[field].value && fields[field].source === "rule" ? "browser-ocr" : fields[field].source,
  }]),
) as ReceiptFrontendFields;

export const extractReceiptFieldsFromText = (text: string, engine: ReceiptFrontendExtraction["engine"] = "rules-only"): ReceiptFrontendExtraction => {
  const lines = linesFromText(text);
  const fields: ReceiptFrontendFields = {
    vendor: extractVendor(lines),
    purchase_date: extractDate(lines),
    subtotal: findLabeledAmount(lines, /\bsub[ -]?total\b/i),
    // Do not infer tax from total - subtotal. Existing tax business rules are
    // intentionally preserved by requiring an explicit, unique tax label.
    tax: findLabeledAmount(lines, /\b(?:tax|gst|hst|vat|sales tax)\b/i),
    total: findLabeledAmount(lines, /\b(?:grand total|total due|amount due|balance due|total)\b/i),
  };
  const unresolvedFields = RECEIPT_FRONTEND_FIELDS.filter((field) => fields[field].status !== "trusted");
  return { text, fields, unresolvedFields, durationMs: 0, engine };
};

export const extractReceiptFieldsFromOcrLines = (
  ocrLines: ReceiptOcrLine[],
  engine: ReceiptFrontendExtraction["engine"] = "tesseract.js",
  textOverride?: string,
  options?: { fallbackToRules?: boolean; useModel?: boolean },
): ReceiptFrontendExtraction => {
  const text = textOverride ?? ocrLines.map((line) => normalizeLine(line.text)).filter(Boolean).join("\n");
  const rules = extractReceiptFieldsFromText(text, engine);
  const lines = normalizedOcrLines(ocrLines);
  // The model is deliberately shadow-only until it clears the real browser
  // OCR promotion gate.  Callers that opt in are benchmark/test code; live
  // extraction remains the validated rules path and stays fail-open.
  if (options?.useModel !== true || !lines.length || fieldModel.version !== 1) return { ...rules, fields: browserOcrFields(rules.fields), ocrLines };
  const fallbackToRules = options?.fallbackToRules !== false;
  const fields = Object.fromEntries(RECEIPT_FRONTEND_FIELDS.map((field) => {
    const ml = modelCandidateResult(lines, field);
    const rule = rules.fields[field];
    // A model proposal may fill an unresolved field, but it never displaces
    // an independently trusted rule result.  This keeps the ML path
    // additive and preserves fail-open behavior for uncertain candidates.
    if (ml.status === "trusted" && (rule.status !== "trusted" || !fallbackToRules)) return [field, ml];
    if (!fallbackToRules) return [field, ml];
    return [field, rule];
  })) as ReceiptFrontendFields;
  const unresolvedFields = RECEIPT_FRONTEND_FIELDS.filter((field) => fields[field].status !== "trusted");
  return { text, fields, unresolvedFields, durationMs: 0, engine, ocrLines };
};

export const extractReceiptFieldsFromImage = async (
  file: Blob | string,
  onProgress?: (progress: number) => void,
): Promise<ReceiptFrontendExtraction> => {
  const started = Date.now();
  try {
    onProgress?.(5);
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      logger: (message) => onProgress?.(5 + Math.round((message.progress || 0) * 75)),
      errorHandler: () => undefined,
    });
    try {
      const pass = await recognizeReceiptOcrPass(worker, file, RECEIPT_OCR_LIVE_STRATEGY);
      const parsed = pass.lines.length
        ? extractReceiptFieldsFromOcrLines(pass.lines, "tesseract.js", pass.text)
        : extractReceiptFieldsFromText(pass.text, "tesseract.js");
      return { ...parsed, fields: browserOcrFields(parsed.fields), durationMs: Date.now() - started };
    } finally {
      await worker.terminate();
    }
  } catch {
    return {
      ...extractReceiptFieldsFromText("", "unavailable"),
      durationMs: Date.now() - started,
    };
  }
};

export const decisionFromExtraction = (extraction: ReceiptFrontendExtraction): ReceiptFrontendDecision => ({
  mode: extraction.unresolvedFields.length === 0 ? "none" : "remaining",
  fields: Object.fromEntries(RECEIPT_FRONTEND_FIELDS
    .filter((field) => extraction.fields[field].status === "trusted")
    .map((field) => [field, extraction.fields[field]])),
  unresolvedFields: extraction.unresolvedFields,
  ocrText: extraction.text,
});
