import type { Gst288ExportFilters, Gst288ExportResult, Gst288ReceiptRow } from "@/lib/gst288Export";
import { analyzeGst288Receipts, gst288CsvFilename } from "@/lib/gst288Export";
import type { Receipt } from "@/hooks/useReceiptApi";

export const GST288_TEMPLATE_PATH = "/forms/gst288-fill-23e.pdf";
export const GST288_TEMPLATE_FILENAME = "gst288-fill-23e.pdf";
export const GST288_MAX_ROWS = 30;
export const GST288_PAGE_ROW_COUNTS = [11, 19] as const;

export interface Gst288ClaimantDetails {
  businessName?: string;
  firstName?: string;
  businessNumber?: string;
}

type FieldAliases = readonly string[];

interface Gst288PageFieldNames {
  pageNumber: FieldAliases;
  pageCount: FieldAliases;
  pageTotal: FieldAliases;
  row: (slot: number, globalRow: number) => {
    date: FieldAliases;
    invoiceId: FieldAliases;
    supplierName: FieldAliases;
    description: FieldAliases;
    tax: FieldAliases;
  };
}

const actualPagePrefix = (page: number): string =>
  page === 1
    ? "form1[0].Page1[0].PartB[0].Table[0]"
    : "form1[0].Page2[0].PartB_contd[0].Table[0]";

const actualPageNumberPrefix = (page: number): string =>
  `form1[0].Page${page}[0].Page_Of_Box[0]`;

const rowAliases = (page: number, slot: number, globalRow: number, field: string): FieldAliases => [
  `${actualPagePrefix(page)}.Row${globalRow}[0].${field === "gst_hst" ? "GST[0].Cell5[0]" : `Cell${field === "date" ? 1 : field === "invoice_id" ? 2 : field === "supplier_name" ? 3 : 4}[0]`}`,
  `row${globalRow}_cell${field === "date" ? 1 : field === "invoice_id" ? 2 : field === "supplier_name" ? 3 : 4}`,
  ...(field === "gst_hst" ? [`${actualPagePrefix(page)}.Row${globalRow}[0].GST[0].Cell5[0]`] : []),
  `page${page}_row${globalRow}_${field}`,
  `page${page}_row${slot}_${field}`,
  `p${page}_${field}_${globalRow}`,
  `p${page}_${field}_${slot}`,
  `${field}_${globalRow}`,
  `${field}${globalRow}`,
  ...(field === "invoice_id" ? [`invoice_${globalRow}`, `invoice${globalRow}`, `invoice_no_${globalRow}`] : []),
  ...(field === "description" ? [`brief_description_${globalRow}`, `briefdescription${globalRow}`, `briefdescriptionofpurchases${globalRow}`] : []),
];

const pageFieldNames = (page: number): Gst288PageFieldNames => ({
  pageNumber: [
    `${actualPageNumberPrefix(page)}.First_Page_Number[0]`,
    `page${page}_number`,
    `page_number_${page}`,
    `page${page}_page_number`,
    `page${page}`,
  ],
  pageCount: [
    `${actualPageNumberPrefix(page)}.Second_Page_Number[0]`,
    `page${page}_count`,
    `page_count_${page}`,
    `page${page}_page_count`,
    `page${page}_of_2`,
    `page${page}of2`,
  ],
  pageTotal: [
    `${actualPagePrefix(page)}.Table_Final_Row[0].Total_GST[0].Cell5[0]`,
    `page${page}_total`,
    `page${page}_gst_hst_total`,
    `gst_hst_total_page${page}`,
    `total_page${page}`,
    `add_amounts_page${page}`,
    `addtheamountslistedonthispage${page}`,
  ],
  row: (slot, globalRow) => ({
    date: rowAliases(page, slot, globalRow, "date"),
    invoiceId: rowAliases(page, slot, globalRow, "invoice_id"),
    supplierName: rowAliases(page, slot, globalRow, "supplier_name"),
    description: rowAliases(page, slot, globalRow, "description"),
    tax: rowAliases(page, slot, globalRow, "gst_hst"),
  }),
});

/**
 * Centralized AcroForm mapping for the unlocked GST288 template. The first
 * names are the stable application mapping; aliases accommodate Acrobat's
 * common page/field naming variants without scattering strings through the
 * filling code.
 */
export const GST288_FIELD_NAMES = {
  claimantName: [
    "form1[0].Page1[0].PartA[0].Claiment_Last_Name[0].Claimants_Last_Name[0]",
    "claimant_business_name",
    "claimant_name",
    "claimants_name_or_business_name",
    "claimants_last_name_or_name_of_business_organization",
    "name_of_business_organization",
  ],
  firstName: [
    "form1[0].Page1[0].PartA[0].Claimant_First_Name[0].Claimants_First_Name[0]",
    "claimant_first_name",
    "first_name",
    "claimants_first_name",
  ],
  businessNumber: [
    "form1[0].Page1[0].PartA[0].BusinessNumber[0].BusinessNumber[0].BusinessNumber_RT1[0]",
    "business_number",
    "claimant_business_number",
  ],
  businessNumberParts: {
    first: [
      "form1[0].Page1[0].PartA[0].BusinessNumber[0].BusinessNumber[0].BusinessNumber_RT1[0]",
      "business_number_first",
    ],
    type: [
      "form1[0].Page1[0].PartA[0].BusinessNumber[0].BusinessNumber[0].BusinessNumber_RT[0]",
      "business_number_type",
    ],
    second: [
      "form1[0].Page1[0].PartA[0].BusinessNumber[0].BusinessNumber[0].BusinessNumber_RT2[0]",
      "business_number_second",
    ],
  },
  page: (page: number) => pageFieldNames(page),
} as const;

interface PdfTextField {
  setText(value: string): void;
}

interface PdfForm {
  getFields?: () => Array<{ getName: () => string }>;
  getTextField(name: string): PdfTextField;
  flatten?: () => void;
}

interface PdfDocument {
  getForm(): PdfForm;
  save(): Promise<Uint8Array>;
}

export interface Gst288PdfDocumentApi {
  load(data: ArrayBuffer | Uint8Array): Promise<PdfDocument>;
}

export interface Gst288PdfBuildOptions {
  loadTemplate?: () => Promise<ArrayBuffer | Uint8Array>;
  /** Test seam; production dynamically imports pdf-lib only when invoked. */
  pdfDocumentApi?: Gst288PdfDocumentApi;
}

export interface Gst288PdfResult extends Omit<Gst288ExportResult, "blob"> {
  blob: Blob;
  filename: string;
}

const normalizeFieldName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const loadTemplateFromPublicPath = async (): Promise<ArrayBuffer> => {
  let response: Response;
  try {
    response = await fetch(GST288_TEMPLATE_PATH);
  } catch (error) {
    throw new Error(`Unable to load ${GST288_TEMPLATE_FILENAME}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Unable to load ${GST288_TEMPLATE_FILENAME} (HTTP ${response.status}).`);
  }
  try {
    return await response.arrayBuffer();
  } catch (error) {
    throw new Error(`Unable to read ${GST288_TEMPLATE_FILENAME}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const availableFieldNames = (form: PdfForm): string[] => {
  try {
    return form.getFields?.().map((field) => field.getName()).filter(Boolean) ?? [];
  } catch {
    return [];
  }
};

const findAvailableFieldName = (form: PdfForm, aliases: FieldAliases): string | undefined => {
  const available = availableFieldNames(form);
  if (available.length === 0) return undefined;
  const availableByNormalized = new Map(available.map((name) => [normalizeFieldName(name), name]));
  for (const alias of aliases) {
    const exact = availableByNormalized.get(normalizeFieldName(alias));
    if (exact) return exact;
  }
  for (const alias of aliases) {
    const normalizedAlias = normalizeFieldName(alias);
    const partial = available.find((name) => normalizeFieldName(name).includes(normalizedAlias));
    if (partial) return partial;
  }
  return undefined;
};

const resolveFieldName = (form: PdfForm, aliases: FieldAliases): string => {
  const available = availableFieldNames(form);
  if (available.length === 0) return aliases[0];
  const fieldName = findAvailableFieldName(form, aliases);
  if (fieldName) return fieldName;
  throw new Error(`GST288 template is missing mapped field: ${aliases[0]}`);
};

const setTextField = (form: PdfForm, aliases: FieldAliases, value: string): void => {
  const fieldName = resolveFieldName(form, aliases);
  try {
    form.getTextField(fieldName).setText(value);
  } catch (error) {
    throw new Error(`Unable to fill GST288 field ${fieldName}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const setOptionalTextField = (form: PdfForm, aliases: FieldAliases, value: string): void => {
  if (availableFieldNames(form).length > 0 && !findAvailableFieldName(form, aliases)) return;
  setTextField(form, aliases, value);
};

const fillBusinessNumber = (form: PdfForm, value: string): void => {
  const businessNumber = value.trim();
  const normalized = businessNumber.replace(/\s+/g, "");
  const parts = /^(\d{9})([A-Za-z]{2})(\d{4})$/.exec(normalized);
  if (parts) {
    setTextField(form, GST288_FIELD_NAMES.businessNumberParts.first, parts[1]);
    setOptionalTextField(form, GST288_FIELD_NAMES.businessNumberParts.type, parts[2]);
    setOptionalTextField(form, GST288_FIELD_NAMES.businessNumberParts.second, parts[3]);
    return;
  }

  setTextField(form, GST288_FIELD_NAMES.businessNumber, businessNumber);
  setOptionalTextField(form, GST288_FIELD_NAMES.businessNumberParts.type, "");
  setOptionalTextField(form, GST288_FIELD_NAMES.businessNumberParts.second, "");
};

const parseTaxCents = (tax: string): number => {
  const parsed = Number(tax);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) : 0;
};

const pageRows = (rows: Gst288ReceiptRow[], page: 1 | 2): Gst288ReceiptRow[] => {
  const start = page === 1 ? 0 : GST288_PAGE_ROW_COUNTS[0];
  const count = GST288_PAGE_ROW_COUNTS[page - 1];
  return rows.slice(start, start + count);
};

const fillPage = (form: PdfForm, page: 1 | 2, rows: Gst288ReceiptRow[]): void => {
  const fields = GST288_FIELD_NAMES.page(page);
  setTextField(form, fields.pageNumber, String(page));
  setTextField(form, fields.pageCount, "2");
  setTextField(form, fields.pageTotal, (rows.reduce((sum, row) => sum + parseTaxCents(row.tax), 0) / 100).toFixed(2));

  rows.forEach((row, index) => {
    const slot = index + 1;
    const globalRow = page === 1 ? slot : GST288_PAGE_ROW_COUNTS[0] + slot;
    const rowFields = fields.row(slot, globalRow);
    setTextField(form, rowFields.date, row.date);
    setTextField(form, rowFields.invoiceId, row.invoiceId);
    setTextField(form, rowFields.supplierName, row.supplierName);
    setTextField(form, rowFields.description, row.description);
    setTextField(form, rowFields.tax, row.tax);
  });
};

const loadPdfDocumentApi = async (): Promise<Gst288PdfDocumentApi> => {
  const { PDFDocument } = await import("pdf-lib");
  return PDFDocument;
};

export const gst288PdfFilename = (filters: Gst288ExportFilters = {}): string =>
  gst288CsvFilename(filters).replace(/\.csv$/i, ".pdf");

/** Fill the local GST288 template using the existing canonical analysis. */
export const buildGst288Pdf = async (
  receipts: Receipt[],
  filters: Gst288ExportFilters = {},
  claimant: Gst288ClaimantDetails = {},
  options: Gst288PdfBuildOptions = {},
): Promise<Gst288PdfResult> => {
  const analyzed = analyzeGst288Receipts(receipts, filters);
  if (analyzed.rows.length > GST288_MAX_ROWS) {
    throw new Error("GST288 supports up to 30 receipts. Narrow the date range before downloading the PDF.");
  }

  const loadTemplate = options.loadTemplate ?? loadTemplateFromPublicPath;
  let templateBytes: ArrayBuffer | Uint8Array;
  try {
    templateBytes = await loadTemplate();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `Unable to load ${GST288_TEMPLATE_FILENAME}.`);
  }

  let pdfDocument: PdfDocument;
  try {
    const api = options.pdfDocumentApi ?? await loadPdfDocumentApi();
    pdfDocument = await api.load(templateBytes);
    const form = pdfDocument.getForm();
    setTextField(form, GST288_FIELD_NAMES.claimantName, claimant.businessName ?? "");
    setTextField(form, GST288_FIELD_NAMES.firstName, claimant.firstName ?? "");
    fillBusinessNumber(form, claimant.businessNumber ?? "");
    fillPage(form, 1, pageRows(analyzed.rows, 1));
    fillPage(form, 2, pageRows(analyzed.rows, 2));
    try {
      form.flatten?.();
    } catch {
      // Keep the filled AcroForm if flattening is unsupported by the template.
    }
    const bytes = await pdfDocument.save();
    return {
      ...analyzed,
      blob: new Blob([bytes], { type: "application/pdf" }),
      filename: gst288PdfFilename(filters),
    };
  } catch (error) {
    throw new Error(`Unable to fill ${GST288_TEMPLATE_FILENAME}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
