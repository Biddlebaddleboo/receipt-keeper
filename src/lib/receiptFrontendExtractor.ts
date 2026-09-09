import { normalizeReceiptPurchaseDate } from "@/lib/receiptDate";

export const RECEIPT_FRONTEND_FIELDS = ["vendor", "purchase_date", "subtotal", "tax", "total"] as const;
export type ReceiptFrontendField = (typeof RECEIPT_FRONTEND_FIELDS)[number];
export type ReceiptFrontendFieldSource = "browser-ocr" | "rule" | "manual";
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
  engine: "tesseract.js" | "unavailable" | "rules-only";
}

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

export const extractReceiptFieldsFromImage = async (
  file: Blob | string,
  onProgress?: (progress: number) => void,
): Promise<ReceiptFrontendExtraction> => {
  const started = Date.now();
  try {
    onProgress?.(5);
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, { logger: (message) => onProgress?.(5 + Math.round((message.progress || 0) * 75)) });
    try {
      const recognized = await worker.recognize(file);
      const parsed = extractReceiptFieldsFromText(recognized.data.text ?? "", "tesseract.js");
      const browserFields = Object.fromEntries(RECEIPT_FRONTEND_FIELDS.map((field) => [field, {
        ...parsed.fields[field],
        source: parsed.fields[field].value ? "browser-ocr" : parsed.fields[field].source,
      }])) as ReceiptFrontendFields;
      return { ...parsed, fields: browserFields, durationMs: Date.now() - started };
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
