import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ReceiptList } from "@/components/ReceiptList";
import { ReceiptDetail } from "@/components/ReceiptDetail";
import { AddReceiptForm } from "@/components/AddReceiptForm";
import { useReceiptApi } from "@/hooks/useReceiptApi";
import { usePrepaidStatus } from "@/hooks/usePrepaidApi";
import { useAuth } from "@/contexts/AuthContext";
import { CreditCard, ScanLine, Plus, Settings, LogOut, RefreshCw, Download, Loader2 } from "lucide-react";
import { preloadReceiptImageConverter } from "@/lib/ffmpegImageConverter";
import { useCategoryApi } from "@/hooks/useCategoryApi";
import { buildReceiptExportZip, filterReceipts, filterReceiptsForExport, receiptExportZipFilename, type ReceiptExportProgress } from "@/lib/receiptExport";
import { fetchSignedReceiptImageUrl } from "@/lib/receiptImage";
import { formatReceiptPurchaseDate } from "@/lib/receiptDate";
import { toast } from "sonner";

const Index = () => {
  const { token, isLoading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const shouldPausePolling = Boolean(selectedReceiptId) || showAddForm;
  const { receipts, receiptsByDate, isUploading, isLoadingMore, hasMore, uploadReceipt, uploadReceiptImage, replaceReceiptImage, removeReceipt, retryUpload, fetchReceipt, fetchAllReceipts, loadNextPage, refreshLatest } =
    useReceiptApi({ pollingPaused: shouldPausePolling });
  const { categories } = useCategoryApi();
  const { enabled: prepaidEnabled } = usePrepaidStatus();
  const didInitialLoadRef = useRef(false);
  const [exportFromDate, setExportFromDate] = useState("");
  const [exportToDate, setExportToDate] = useState("");
  const [exportCategories, setExportCategories] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [matchingReceiptCount, setMatchingReceiptCount] = useState<number | null>(null);
  const [exportProgress, setExportProgress] = useState<ReceiptExportProgress | null>(null);
  const [vendorFilter, setVendorFilter] = useState("");
  const [receiptFilterCategories, setReceiptFilterCategories] = useState<string[]>([]);
  const [receiptFromDate, setReceiptFromDate] = useState("");
  const [receiptToDate, setReceiptToDate] = useState("");
  const [allReceiptsForFiltering, setAllReceiptsForFiltering] = useState<typeof receipts | null>(null);
  const [isLoadingFilteredReceipts, setIsLoadingFilteredReceipts] = useState(false);

  const hasReceiptFilters = Boolean(
    vendorFilter.trim() ||
    receiptFilterCategories.length > 0 ||
    receiptFromDate ||
    receiptToDate
  );
  const invalidReceiptDateRange = Boolean(receiptFromDate && receiptToDate && receiptFromDate > receiptToDate);

  const categoryOptions = useMemo(
    () => Array.from(new Set([
      ...categories.map((category) => category.name),
      ...receipts.map((receipt) => receipt.category),
      ...(allReceiptsForFiltering ?? []).map((receipt) => receipt.category),
    ].filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [allReceiptsForFiltering, categories, receipts]
  );

  useEffect(() => {
    if (!hasReceiptFilters) {
      setAllReceiptsForFiltering(null);
      setIsLoadingFilteredReceipts(false);
      return;
    }

    let cancelled = false;
    setIsLoadingFilteredReceipts(true);
    void fetchAllReceipts()
      .then((allReceipts) => {
        if (cancelled) return;
        setAllReceiptsForFiltering(allReceipts);
      })
      .catch(() => {
        if (cancelled) return;
        setAllReceiptsForFiltering([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFilteredReceipts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchAllReceipts, hasReceiptFilters]);

  useEffect(() => {
    preloadReceiptImageConverter();
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      didInitialLoadRef.current = false;
      return;
    }
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    loadNextPage();
  }, [authLoading, token, loadNextPage]);

  const totalSpent = receipts.reduce((sum, r) => sum + r.total, 0);
  const selectedReceipt = selectedReceiptId
    ? receipts.find((receipt) => receipt.id === selectedReceiptId)
      ?? allReceiptsForFiltering?.find((receipt) => receipt.id === selectedReceiptId)
      ?? null
    : null;

  const filteredReceiptsByDate = useMemo(() => {
    if (!hasReceiptFilters) return receiptsByDate;
    if (!allReceiptsForFiltering) return {};

    const matchingReceipts = filterReceipts(allReceiptsForFiltering, {
      vendor: vendorFilter,
      categories: receiptFilterCategories,
      fromDate: receiptFromDate,
      toDate: receiptToDate,
    });

    return matchingReceipts.reduce<Record<string, typeof receipts>>((groups, receipt) => {
      const dateLabel = receipt.purchase_date
        ? formatReceiptPurchaseDate(receipt.purchase_date, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "Unknown Date";
      if (!groups[dateLabel]) groups[dateLabel] = [];
      groups[dateLabel].push(receipt);
      return groups;
    }, {});
  }, [allReceiptsForFiltering, hasReceiptFilters, receiptFilterCategories, receiptFromDate, receiptToDate, receiptsByDate, vendorFilter]);

  const clearReceiptFilters = () => {
    setVendorFilter("");
    setReceiptFilterCategories([]);
    setReceiptFromDate("");
    setReceiptToDate("");
  };

  const resetExportStatus = () => {
    setMatchingReceiptCount(null);
    setExportProgress(null);
  };

  const downloadReceipts = async () => {
    if (exportFromDate && exportToDate && exportFromDate > exportToDate) {
      toast.error("From date must be on or before the to date");
      return;
    }

    setIsExporting(true);
    setMatchingReceiptCount(null);
    setExportProgress({ completed: 0, total: 0, percentage: 0, phase: "fetching" });
    try {
      const allReceipts = await fetchAllReceipts();
      const filters = {
        fromDate: exportFromDate,
        toDate: exportToDate,
        categories: exportCategories,
      };
      const matchingReceipts = filterReceiptsForExport(allReceipts, filters);
      setMatchingReceiptCount(matchingReceipts.length);
      if (matchingReceipts.length === 0) {
        throw new Error("No receipts match the selected filters");
      }
      setExportProgress({ completed: 0, total: matchingReceipts.length, percentage: 0, phase: "fetching" });

      const zip = await buildReceiptExportZip(matchingReceipts, {
        ...filters,
        getImageUrl: (receipt) => fetchSignedReceiptImageUrl(receipt.id),
        onProgress: setExportProgress,
      });
      const url = URL.createObjectURL(zip);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = receiptExportZipFilename(filters);
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`Downloaded ${matchingReceipts.length} receipt${matchingReceipts.length === 1 ? "" : "s"}`);
    } catch (error) {
      setExportProgress(null);
      toast.error(error instanceof Error ? error.message : "Failed to download receipts");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <ScanLine className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold leading-tight tracking-tight">
              Receipt Scanner
            </h1>
            <p className="text-xs text-muted-foreground">
              {receipts.length === 0
                ? "Capture & upload receipts"
                : `${receipts.length} receipt${receipts.length !== 1 ? "s" : ""} · $${totalSpent.toFixed(2)} total`}
            </p>
          </div>
          <button
            onClick={() => navigate("/settings")}
            className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
          >
            <Settings className="w-5 h-5 text-muted-foreground" />
          </button>
          {prepaidEnabled && (
            <button
              onClick={() => navigate("/prepaid")}
              className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
              title="Prepaid cards"
            >
              <CreditCard className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={() => void refreshLatest()}
            className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
            title="Reload receipts"
          >
            <RefreshCw className="w-5 h-5 text-muted-foreground" />
          </button>
          <button
            onClick={signOut}
            className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
            title="Sign out"
          >
            <LogOut className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <section className="mb-4 rounded-xl border bg-card p-4 shadow-sm" aria-label="Filter receipts">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Find receipts</h2>
              <p className="text-xs text-muted-foreground">Search all of your receipts</p>
            </div>
            <button
              type="button"
              onClick={clearReceiptFilters}
              disabled={!hasReceiptFilters}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear filters
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
              Store name
              <input
                type="search"
                value={vendorFilter}
                onChange={(event) => setVendorFilter(event.target.value)}
                placeholder="Search store name"
                aria-label="Store name"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal text-foreground"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
              Categories <span className="font-normal">(choose any)</span>
              <select
                multiple
                value={receiptFilterCategories}
                onChange={(event) => setReceiptFilterCategories(Array.from(event.target.selectedOptions, (option) => option.value))}
                aria-label="Filter receipt categories"
                className="mt-1 min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal text-foreground"
              >
                {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              From date
              <input
                type="date"
                value={receiptFromDate}
                onChange={(event) => setReceiptFromDate(event.target.value)}
                aria-label="Filter from date"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal text-foreground"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              To date
              <input
                type="date"
                value={receiptToDate}
                onChange={(event) => setReceiptToDate(event.target.value)}
                aria-label="Filter to date"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal text-foreground"
              />
            </label>
          </div>
          {invalidReceiptDateRange && (
            <p className="mt-2 text-xs text-destructive" role="alert">From date must be on or before the to date.</p>
          )}
        </section>
        <section className="mb-6 rounded-xl border bg-card p-4 shadow-sm" aria-label="Download receipts">
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Download Receipts</h2>
            <p className="text-xs text-muted-foreground">Export matching receipts as JPEG images in one ZIP.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">
              From date
              <input
                type="date"
                value={exportFromDate}
                onChange={(event) => {
                  setExportFromDate(event.target.value);
                  resetExportStatus();
                }}
                disabled={isExporting}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal text-foreground"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              To date
              <input
                type="date"
                value={exportToDate}
                onChange={(event) => {
                  setExportToDate(event.target.value);
                  resetExportStatus();
                }}
                disabled={isExporting}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal text-foreground"
              />
            </label>
          </div>
          <label className="mt-3 block text-xs font-medium text-muted-foreground">
            Categories <span className="font-normal">(all by default)</span>
            <select
              multiple
              value={exportCategories}
              onChange={(event) => {
                setExportCategories(Array.from(event.target.selectedOptions, (option) => option.value));
                resetExportStatus();
              }}
              disabled={isExporting}
              aria-label="Receipt categories"
              className="mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal text-foreground"
            >
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          {matchingReceiptCount !== null && (
            <p className="mt-3 text-xs text-muted-foreground" role="status">
              {matchingReceiptCount} matching receipt{matchingReceiptCount === 1 ? "" : "s"}
            </p>
          )}
          {exportProgress && (
            <div className="mt-3 space-y-1.5" aria-live="polite">
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-label="Receipt export progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={exportProgress.percentage}
              >
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${exportProgress.percentage}%` }} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{exportProgress.percentage}% · {exportProgress.completed} of {exportProgress.total} receipts</span>
                <span className="capitalize">{exportProgress.phase}</span>
              </div>
              {exportProgress.filename && (
                <p className="truncate text-xs text-muted-foreground" title={exportProgress.filename}>
                  {exportProgress.filename}
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void downloadReceipts()}
            disabled={isExporting}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isExporting ? "Preparing ZIP…" : "Download Receipts"}
          </button>
        </section>
        <ReceiptList
          receiptsByDate={filteredReceiptsByDate}
          onReceiptClick={(receipt) => setSelectedReceiptId(receipt.id)}
          hasMore={hasReceiptFilters ? false : hasMore}
          isLoadingMore={hasReceiptFilters ? isLoadingFilteredReceipts : isLoadingMore}
          onLoadMore={hasReceiptFilters ? undefined : loadNextPage}
          emptyMessage={hasReceiptFilters ? (isLoadingFilteredReceipts ? "Loading receipts…" : "No receipts match your filters") : undefined}
          emptyDescription={hasReceiptFilters ? "Try adjusting your filters or clear them to see every receipt" : undefined}
        />
      </main>

      {/* FAB */}
      <button
        onClick={() => setShowAddForm(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center receipt-shadow hover:brightness-110 transition-all active:scale-95 z-10"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Detail overlay */}
      {selectedReceipt && (
        <ReceiptDetail
          receipt={selectedReceipt}
          onClose={() => setSelectedReceiptId(null)}
          onRemove={removeReceipt}
          onRetry={retryUpload}
          fetchReceipt={fetchReceipt}
          uploadReceiptImage={uploadReceiptImage}
          replaceReceiptImage={replaceReceiptImage}
        />
      )}

      {/* Add form overlay */}
      {showAddForm && (
        <AddReceiptForm
          onSubmit={uploadReceipt}
          onClose={() => setShowAddForm(false)}
          disabled={isUploading}
        />
      )}
    </div>
  );
};

export default Index;
