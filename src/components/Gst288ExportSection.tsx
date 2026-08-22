import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Receipt } from "@/hooks/useReceiptApi";
import { buildGst288Export, gst288CsvFilename, type Gst288ExportSummary } from "@/lib/gst288Export";
import { buildGst288Pdf, gst288PdfFilename, type Gst288ClaimantDetails } from "@/lib/gst288Pdf";
import { readGst288NameSettings, writeGst288NameSettings } from "@/lib/gst288Settings";

interface Gst288ExportSectionProps {
  fetchAllReceipts: () => Promise<Receipt[]>;
}

const summaryText = (summary: Gst288ExportSummary): string =>
  `${summary.totalReceipts} receipts · ${summary.matched} matched · ${summary.ambiguous} ambiguous · ${summary.unmatched} unmatched`;

export function Gst288ExportSection({ fetchAllReceipts }: Gst288ExportSectionProps) {
  const { firebaseUID, user } = useAuth();
  const { toast } = useToast();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [taxRate, setTaxRate] = useState("13");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [summary, setSummary] = useState<Gst288ExportSummary | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const isBusy = isExporting || isExportingPdf;
  const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate);
  const settingsIdentity = user?.email?.trim().toLowerCase() || firebaseUID || "";
  const loadedSettingsIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    loadedSettingsIdentityRef.current = null;
    if (!settingsIdentity) {
      setLastName("");
      setFirstName("");
      return;
    }
    const saved = readGst288NameSettings(settingsIdentity);
    setLastName(saved.lastName);
    setFirstName(saved.firstName);
    loadedSettingsIdentityRef.current = settingsIdentity;
  }, [settingsIdentity]);

  useEffect(() => {
    if (!settingsIdentity || loadedSettingsIdentityRef.current !== settingsIdentity) return;
    const timeout = window.setTimeout(() => {
      writeGst288NameSettings(settingsIdentity, { firstName, lastName });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [firstName, lastName, settingsIdentity]);

  const validateInputs = (): number | null => {
    if (invalidDateRange) {
      toast({ title: "Invalid date range", description: "From date must be on or before the to date.", variant: "destructive" });
      return null;
    }
    const parsedRate = Number(taxRate);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0 || parsedRate > 100) {
      toast({ title: "Invalid GST/HST rate", description: "Enter a rate between 0 and 100%.", variant: "destructive" });
      return null;
    }
    return parsedRate;
  };

  const exportFilters = (parsedRate: number) => ({
    fromDate,
    toDate,
    taxRatePercent: parsedRate,
  });

  const download = async () => {
    const parsedRate = validateInputs();
    if (parsedRate === null) return;

    setIsExporting(true);
    setSummary(null);
    try {
      const receipts = await fetchAllReceipts();
      const result = buildGst288Export(receipts, exportFilters(parsedRate));
      setSummary(result.summary);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = gst288CsvFilename(exportFilters(parsedRate));
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast({ title: "GST288 CSV downloaded", description: summaryText(result.summary) });
    } catch (error) {
      toast({
        title: "GST288 export failed",
        description: error instanceof Error ? error.message : "Unable to create GST288 CSV.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const downloadPdf = async () => {
    const parsedRate = validateInputs();
    if (parsedRate === null) return;

    setIsExportingPdf(true);
    setSummary(null);
    try {
      const receipts = await fetchAllReceipts();
      const claimant: Gst288ClaimantDetails = { lastName, firstName };
      const result = await buildGst288Pdf(receipts, exportFilters(parsedRate), claimant);
      setSummary(result.summary);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = gst288PdfFilename(exportFilters(parsedRate));
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast({ title: "GST288 PDF downloaded", description: summaryText(result.summary) });
    } catch (error) {
      toast({
        title: "GST288 PDF export failed",
        description: error instanceof Error ? error.message : "Unable to create GST288 PDF.",
        variant: "destructive",
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <section className="rounded-xl bg-card p-4 receipt-shadow" aria-label="GST288 export">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">GST288 export</h2>
        <p className="text-xs text-muted-foreground">Create a filtered GST/HST CSV or PDF from your receipts.</p>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-muted-foreground">
          Last name
          <input
            type="text"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            aria-label="GST288 last name"
            disabled={isBusy}
            className="mt-1 w-full rounded-md border bg-background px-2.5 py-2 text-sm font-normal text-foreground"
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          First name
          <input
            type="text"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            aria-label="GST288 first name"
            disabled={isBusy}
            className="mt-1 w-full rounded-md border bg-background px-2.5 py-2 text-sm font-normal text-foreground"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-muted-foreground">
          From date
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            aria-label="GST288 from date"
            disabled={isBusy}
            className="mt-1 w-full rounded-md border bg-background px-2.5 py-2 text-sm font-normal text-foreground"
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          To date
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            aria-label="GST288 to date"
            disabled={isBusy}
            className="mt-1 w-full rounded-md border bg-background px-2.5 py-2 text-sm font-normal text-foreground"
          />
        </label>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
          GST/HST rate (%)
          <input
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={taxRate}
            onChange={(event) => setTaxRate(event.target.value)}
            aria-label="GST/HST rate"
            disabled={isBusy}
            className="mt-1 w-full rounded-md border bg-background px-2.5 py-2 text-sm font-normal text-foreground"
          />
        </label>
        <div className="grid shrink-0 grid-cols-2 gap-2">
          <Button type="button" onClick={() => void download()} disabled={isBusy} className="gap-1.5">
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isExporting ? "Preparing CSV…" : "Download CSV"}
          </Button>
          <Button type="button" onClick={() => void downloadPdf()} disabled={isBusy} className="gap-1.5">
            {isExportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isExportingPdf ? "Preparing PDF…" : "Download GST288 PDF"}
          </Button>
        </div>
      </div>
      {invalidDateRange && (
        <p className="mt-2 text-xs text-destructive" role="alert">From date must be on or before the to date.</p>
      )}
      {summary && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">{summaryText(summary)}</p>
      )}
    </section>
  );
}
