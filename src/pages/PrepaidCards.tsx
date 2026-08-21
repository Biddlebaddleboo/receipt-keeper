import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Archive, Camera, CreditCard, Download, Eye, FileImage, Loader2, Plus, RefreshCw, ScanLine, Search, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AddPrepaidPurchaseFlow } from "@/components/prepaid/AddPrepaidPurchaseFlow";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";
import { convertImageBlobToJpeg } from "@/lib/nativeImageConverter";
import { Receipt, useReceiptApi } from "@/hooks/useReceiptApi";
import { PrepaidActivationReceipt, PrepaidCard, PrepaidCleanupSummary, PrepaidPurchase, PrepaidSearchResult, usePrepaidApi, usePrepaidStatus } from "@/hooks/usePrepaidApi";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";
import { formatReceiptPurchaseDate } from "@/lib/receiptDate";

interface SelectedCard {
  purchase: PrepaidPurchase;
  card: PrepaidCard;
}

interface ImageModalState {
  title: string;
  url: string;
  filename: string;
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

async function signedSalesReceiptUrl(receiptID: string) {
  const response = await apiFetch(`${API_BASE_URL}/receipts/sign-image`, {
    method: "POST",
    body: JSON.stringify({ receipt_id: receiptID }),
  });
  if (!response.ok) throw new Error("Sales receipt image is unavailable");
  const payload = (await response.json()) as { image_url?: string };
  if (!payload.image_url) throw new Error("Sales receipt image is unavailable");
  return payload.image_url;
}

async function downloadImageFromSignedURL(imageUrl: string, filename: string) {
  const response = await fetch(imageUrl, { credentials: "omit" });
  if (!response.ok) throw new Error("Download failed");
  const sourceBlob = await response.blob();
  const jpegBlob = await convertImageBlobToJpeg(sourceBlob);
  if (jpegBlob.type !== "image/jpeg") throw new Error("Image conversion to JPEG failed");
  const url = URL.createObjectURL(jpegBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.replace(/\.[^.]+$/, "") + ".jpg";
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function downloadFromSignedURL(getURL: () => Promise<string> | string, filename: string) {
  const imageUrl = typeof getURL === "string" ? getURL : await getURL();
  await downloadImageFromSignedURL(imageUrl, filename);
}

function safeCardIdentifier(card: PrepaidCard) {
  const last4 = digitsOnly(card.last4 || "");
  if (last4) return last4.slice(-4);
  return (card.id || "card").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "card";
}

function cardImageFilename(kind: "package" | "opened-card", card: PrepaidCard) {
  const prefix = kind === "package" ? "package-card" : "opened-card";
  return `${prefix}-${safeCardIdentifier(card)}.jpg`;
}

const PrepaidCards = () => {
  const navigate = useNavigate();
  const { enabled, isLoading: statusLoading } = usePrepaidStatus();
  const { cleanupArchivedImages, listPurchases, searchCards, signActivationReceiptImage } = usePrepaidApi();
  const { fetchReceipt } = useReceiptApi({ pollingPaused: true });
  const [activePurchases, setActivePurchases] = useState<PrepaidPurchase[]>([]);
  const [archivedPurchases, setArchivedPurchases] = useState<PrepaidPurchase[]>([]);
  const [receiptMap, setReceiptMap] = useState<Record<string, Receipt | null>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showAddFlow, setShowAddFlow] = useState(false);
  const [selected, setSelected] = useState<SelectedCard | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Receipt | null>(null);
  const [activationImage, setActivationImage] = useState<ImageModalState | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<PrepaidSearchResult[]>([]);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [searching, setSearching] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const loadReceiptSummaries = useCallback(async (purchases: PrepaidPurchase[]) => {
    const ids = Array.from(new Set(purchases.map((purchase) => purchase.sales_receipt_id).filter(Boolean)));
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await fetchReceipt(id)] as const;
        } catch {
          return [id, null] as const;
        }
      }),
    );
    setReceiptMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }, [fetchReceipt]);

  const load = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    try {
      const [active, archived] = await Promise.all([
        listPurchases("active"),
        listPurchases("archived"),
      ]);
      setActivePurchases(active);
      setArchivedPurchases(archived);
      void loadReceiptSummaries([...active, ...archived]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load prepaid cards";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, listPurchases, loadReceiptSummaries]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeGroups = useMemo(() => activePurchases.filter((purchase) => purchase.cards.length > 0), [activePurchases]);
  const archivedGroups = useMemo(() => archivedPurchases.filter((purchase) => purchase.cards.length > 0), [archivedPurchases]);

  const openSalesReceipt = async (receiptID: string) => {
    const existing = receiptMap[receiptID];
    if (existing) {
      setViewingReceipt(existing);
      return;
    }
    const fresh = await fetchReceipt(receiptID);
    if (!fresh) {
      toast.error("Sales receipt is unavailable");
      return;
    }
    setReceiptMap((prev) => ({ ...prev, [receiptID]: fresh }));
    setViewingReceipt(fresh);
  };

  const openActivationReceipt = async (purchaseID: string, receipt: PrepaidActivationReceipt, index: number) => {
    try {
      const url = await signActivationReceiptImage(purchaseID, receipt.id);
      setActivationImage({ title: `Activation receipt ${index + 1}`, url, filename: `activation-receipt-${index + 1}.jpg` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Activation receipt image is unavailable");
    }
  };

  const downloadSalesReceipt = async (receiptID: string) => {
    try {
      await downloadFromSignedURL(() => signedSalesReceiptUrl(receiptID), "sales-receipt.jpg");
    } catch {
      toast.error("Failed to download sales receipt");
    }
  };

  const downloadActivationReceipt = async (purchaseID: string, receipt: PrepaidActivationReceipt, index: number) => {
    try {
      await downloadFromSignedURL(
        () => signActivationReceiptImage(purchaseID, receipt.id),
        `activation-receipt-${index + 1}.jpg`,
      );
    } catch {
      toast.error("Failed to download activation receipt");
    }
  };

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = digitsOnly(searchValue);
    setSearchValue(normalized);
    if (normalized.length !== 4 && normalized.length !== 16) {
      setSearchError("Enter exactly 4 or 16 digits.");
      setSearchResults([]);
      setSearchSubmitted(true);
      return;
    }
    setSearchError("");
    setSearchSubmitted(true);
    setSearching(true);
    try {
      setSearchResults(await searchCards(normalized));
    } catch (error) {
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const openSearchResult = async (result: PrepaidSearchResult) => {
    const containsResultCard = (entry: PrepaidPurchase) =>
      entry.id === result.purchase_id && entry.cards.some((card) => card.id === result.card_id);
    let purchase = [...activePurchases, ...archivedPurchases].find(containsResultCard);
    if (!purchase) {
      try {
        const allPurchases = await listPurchases("all");
        purchase = allPurchases.find(containsResultCard);
      } catch {
        purchase = undefined;
      }
    }
    const card = purchase?.cards.find((entry) => entry.id === result.card_id);
    if (!purchase || !card) {
      toast.error("Card details are unavailable");
      return;
    }
    void loadReceiptSummaries([purchase]);
    setSelected({ purchase, card });
  };

  const handleCleanupArchivedImages = async () => {
    const confirmed = window.confirm(
      "Package and opened-card photos for archived cards will be permanently deleted. Activation receipt photos will also be deleted for purchases where every card is archived. Original sales receipts and all extracted card information will be kept.",
    );
    if (!confirmed) return;

    setCleanupBusy(true);
    try {
      const summary = await cleanupArchivedImages();
      await load();
      toast.success(formatCleanupSummary(summary));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to clean up archived photos");
    } finally {
      setCleanupBusy(false);
    }
  };

  if (!statusLoading && !enabled) {
    return (
      <div className="min-h-screen bg-background">
        <Header onBack={() => navigate("/")} onRefresh={load} refreshing={isLoading} />
        <main className="max-w-2xl mx-auto px-4 py-10">
          <Alert>
            <AlertDescription>Prepaid card tracking is not enabled for this account.</AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header onBack={() => navigate("/")} onRefresh={load} refreshing={isLoading} />

      <main className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <form onSubmit={submitSearch} className="rounded-lg border bg-card p-3 space-y-2" aria-label="Search prepaid cards">
          <div className="flex gap-2">
            <Input
              value={searchValue}
              onChange={(event) => {
                setSearchValue(digitsOnly(event.target.value));
                setSearchError("");
              }}
              inputMode="numeric"
              maxLength={23}
              placeholder="Search full card number or last 4"
              aria-label="Search full card number or last 4"
            />
            <Button type="submit" disabled={searching}>
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Search
            </Button>
          </div>
          {searchError && <p className="text-sm text-destructive" role="alert">{searchError}</p>}
        </form>

        {searchSubmitted && !searchError && (
          <section className="mt-4 rounded-lg border bg-card p-4 space-y-3" aria-label="Search results">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Search results</h2>
              <span className="text-xs text-muted-foreground">{searchResults.length} match{searchResults.length === 1 ? "" : "es"}</span>
            </div>
            {searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">No prepaid cards found.</p>
            ) : (
              <div className="space-y-2">
                {searchResults.map((result) => {
                  const receipt = receiptMap[result.sales_receipt_id];
                  return (
                    <PrepaidSearchResultRow
                      key={`${result.purchase_id}-${result.card_id}`}
                      result={result}
                      receipt={receipt}
                      onClick={() => void openSearchResult(result)}
                    />
                  );
                })}
              </div>
            )}
          </section>
        )}

        <section className="mt-4 rounded-lg border bg-card p-4 space-y-3" aria-label="Archive photo management">
          <div>
            <h2 className="text-sm font-semibold">Archive photo management</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Remove photos from archived cards while keeping sales receipts and extracted card information.
            </p>
          </div>
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => void handleCleanupArchivedImages()} disabled={cleanupBusy || isLoading}>
            {cleanupBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Clean Up Archived Photos
          </Button>
        </section>

        <Tabs defaultValue="active" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archive">Archive</TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="space-y-3">
            {isLoading && activeGroups.length === 0 ? (
              <LoadingState />
            ) : activeGroups.length === 0 ? (
              <EmptyState label="No active prepaid cards" />
            ) : (
              activeGroups.map((purchase) => (
                <PrepaidPurchaseGroup
                  key={purchase.id}
                  purchase={purchase}
                  receipt={receiptMap[purchase.sales_receipt_id]}
                  onCardClick={(card) => setSelected({ purchase, card })}
                  onViewSalesReceipt={() => openSalesReceipt(purchase.sales_receipt_id)}
                  onDownloadSalesReceipt={() => downloadSalesReceipt(purchase.sales_receipt_id)}
                  onViewActivationReceipt={(receipt, index) => openActivationReceipt(purchase.id, receipt, index)}
                  onDownloadActivationReceipt={(receipt, index) => downloadActivationReceipt(purchase.id, receipt, index)}
                />
              ))
            )}
          </TabsContent>
          <TabsContent value="archive" className="space-y-3">
            {isLoading && archivedGroups.length === 0 ? (
              <LoadingState />
            ) : archivedGroups.length === 0 ? (
              <EmptyState label="No archived prepaid cards" />
            ) : (
              archivedGroups.map((purchase) => (
                <PrepaidPurchaseGroup
                  key={purchase.id}
                  purchase={purchase}
                  receipt={receiptMap[purchase.sales_receipt_id]}
                  onCardClick={(card) => setSelected({ purchase, card })}
                  onViewSalesReceipt={() => openSalesReceipt(purchase.sales_receipt_id)}
                  onDownloadSalesReceipt={() => downloadSalesReceipt(purchase.sales_receipt_id)}
                  onViewActivationReceipt={(receipt, index) => openActivationReceipt(purchase.id, receipt, index)}
                  onDownloadActivationReceipt={(receipt, index) => downloadActivationReceipt(purchase.id, receipt, index)}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>

      <button
        onClick={() => setShowAddFlow(true)}
        className="fixed bottom-6 right-6 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground receipt-shadow hover:brightness-110 active:scale-95"
      >
        <Plus className="w-6 h-6" />
      </button>

      {showAddFlow && (
        <AddPrepaidPurchaseFlow
          onClose={() => setShowAddFlow(false)}
          onSaved={() => {
            void load();
          }}
        />
      )}

      {selected && (
        <PrepaidCardDetail
          entry={selected}
          receipt={receiptMap[selected.purchase.sales_receipt_id]}
          onViewSalesReceipt={() => void openSalesReceipt(selected.purchase.sales_receipt_id)}
          onDownloadSalesReceipt={() => void downloadSalesReceipt(selected.purchase.sales_receipt_id)}
          onViewActivationReceipt={(receipt, index) => void openActivationReceipt(selected.purchase.id, receipt, index)}
          onDownloadActivationReceipt={(receipt, index) => void downloadActivationReceipt(selected.purchase.id, receipt, index)}
          onClose={() => setSelected(null)}
          onUpdated={(purchase) => {
            setSelected(null);
            mergePurchase(purchase, setActivePurchases, setArchivedPurchases);
            void load();
          }}
        />
      )}

      {viewingReceipt && <SalesReceiptViewer receipt={viewingReceipt} onClose={() => setViewingReceipt(null)} />}
      {activationImage && <ImageViewer title={activationImage.title} imageUrl={activationImage.url} filename={activationImage.filename} onClose={() => setActivationImage(null)} />}
    </div>
  );
};

function formatCleanupSummary(summary: PrepaidCleanupSummary) {
  const failures = summary.image_deletion_failures ?? 0;
  const failureText = failures > 0 ? ` ${failures} image${failures === 1 ? "" : "s"} could not be deleted.` : "";
  return `Archived photo cleanup complete: ${summary.package_images_deleted} package, ${summary.opened_card_images_deleted} opened-card, and ${summary.activation_receipt_images_deleted} activation receipt image${summary.activation_receipt_images_deleted === 1 ? "" : "s"} deleted. ${summary.sales_receipts_preserved} sales receipt${summary.sales_receipts_preserved === 1 ? "" : "s"} preserved.${failureText}`;
}

function Header({ onBack, onRefresh, refreshing }: { onBack: () => void; onRefresh: () => void; refreshing: boolean }) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 px-4 py-4 backdrop-blur-md">
      <div className="max-w-2xl mx-auto flex items-center gap-3">
        <button onClick={onBack} className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CreditCard className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight">Prepaid Cards</h1>
          <p className="text-xs text-muted-foreground">Private tracker</p>
        </div>
        <button onClick={onRefresh} className="p-2 rounded-md hover:bg-secondary transition-colors" disabled={refreshing}>
          {refreshing ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : <RefreshCw className="w-5 h-5 text-muted-foreground" />}
        </button>
      </div>
    </header>
  );
}

function PrepaidPurchaseGroup({
  purchase,
  receipt,
  onCardClick,
  onViewSalesReceipt,
  onDownloadSalesReceipt,
  onViewActivationReceipt,
  onDownloadActivationReceipt,
}: {
  purchase: PrepaidPurchase;
  receipt?: Receipt | null;
  onCardClick: (card: PrepaidCard) => void;
  onViewSalesReceipt: () => void;
  onDownloadSalesReceipt: () => void;
  onViewActivationReceipt: (receipt: PrepaidActivationReceipt, index: number) => void;
  onDownloadActivationReceipt: (receipt: PrepaidActivationReceipt, index: number) => void;
}) {
  const vendor = receipt?.vendor?.trim() || "Retailer";
  const date = receipt?.purchase_date
    ? formatReceiptPurchaseDate(receipt.purchase_date, { month: "short", day: "numeric", year: "numeric" })
    : purchase.created_at
      ? formatReceiptPurchaseDate(purchase.created_at, { month: "short", day: "numeric", year: "numeric" })
      : "";

  return (
    <section className="rounded-lg border bg-card p-4 receipt-shadow space-y-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{vendor}</h2>
            <p className="text-xs text-muted-foreground">{date || "Date unavailable"}</p>
          </div>
          <span className="text-xs text-muted-foreground">Sales receipt ✓</span>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Sales receipt actions">
          <Button variant="outline" size="sm" onClick={onViewSalesReceipt}>
            <Eye className="w-4 h-4 mr-2" />
            View sales
          </Button>
          <Button variant="outline" size="sm" onClick={onDownloadSalesReceipt}>
            <Download className="w-4 h-4 mr-2" />
            Download sales
          </Button>
          <span className="inline-flex h-9 items-center rounded-md border px-3 text-xs text-muted-foreground">
            Activation receipts ({purchase.activation_receipts.length})
          </span>
        </div>
        {purchase.activation_receipts.some((entry) => entry.storage_path?.trim()) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {purchase.activation_receipts.map((activationReceipt, index) => activationReceipt.storage_path?.trim() ? (
              <div
                key={activationReceipt.id}
                className="rounded-md border bg-background p-2 space-y-2"
                role="group"
                aria-label={`Activation receipt ${index + 1}`}
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileImage className="w-4 h-4" />
                  <span className="truncate">Activation {index + 1}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => onViewActivationReceipt(activationReceipt, index)}>
                    <Eye className="w-4 h-4 mr-2" />
                    View
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onDownloadActivationReceipt(activationReceipt, index)}>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>
              </div>
            ) : null)}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {purchase.cards.map((card) => (
          <PrepaidCardRow key={card.id} card={card} onClick={() => onCardClick(card)} />
        ))}
      </div>
    </section>
  );
}

function PrepaidCardRow({ card, onClick }: { card: PrepaidCard; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full rounded-md bg-secondary/45 p-3 text-left transition-colors hover:bg-secondary active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">${(card.denomination ?? 0).toFixed(2)} Vanilla</span>
            {card.state === "archived" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Archived</span>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {card.details_captured && card.last4 ? `•••• ${card.last4}` : "Card details not captured"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground break-all">Package barcode: {shortBarcode(card.activation_barcode)}</p>
        </div>
      </div>
    </button>
  );
}

function PrepaidSearchResultRow({
  result,
  receipt,
  onClick,
}: {
  result: PrepaidSearchResult;
  receipt?: Receipt | null;
  onClick: () => void;
}) {
  const vendor = receipt?.vendor?.trim() || "Retailer unavailable";
  const dateValue = receipt?.purchase_date || result.created_at;
  const date = dateValue
    ? formatReceiptPurchaseDate(dateValue, { month: "short", day: "numeric", year: "numeric" })
    : "Date unavailable";
  const state = result.state === "archived" ? "Archived" : "Active";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md bg-secondary/45 p-3 text-left transition-colors hover:bg-secondary active:scale-[0.99]"
      aria-label={`Open ${state} ${result.last4 ? `card ending ${result.last4}` : "prepaid card"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">${(result.denomination ?? 0).toFixed(2)} Vanilla</p>
          <p className="mt-1 text-xs text-muted-foreground">•••• {result.last4 || "unknown"}</p>
          <p className="mt-1 text-xs text-muted-foreground truncate">{vendor} · {date}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{state}</span>
      </div>
    </button>
  );
}

function RelatedReceiptActions({
  purchase,
  onViewSalesReceipt,
  onDownloadSalesReceipt,
  onViewActivationReceipt,
  onDownloadActivationReceipt,
}: {
  purchase: PrepaidPurchase;
  onViewSalesReceipt: () => void;
  onDownloadSalesReceipt: () => void;
  onViewActivationReceipt: (receipt: PrepaidActivationReceipt, index: number) => void;
  onDownloadActivationReceipt: (receipt: PrepaidActivationReceipt, index: number) => void;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3" aria-label="Related receipts">
      <p className="text-sm font-medium">Related receipts</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Sales receipt actions">
        <Button variant="outline" size="sm" onClick={onViewSalesReceipt}>
          <Eye className="w-4 h-4 mr-2" />
          View sales
        </Button>
        <Button variant="outline" size="sm" onClick={onDownloadSalesReceipt}>
          <Download className="w-4 h-4 mr-2" />
          Download sales
        </Button>
      </div>
      {purchase.activation_receipts.some((entry) => entry.storage_path?.trim()) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {purchase.activation_receipts.map((receipt, index) => receipt.storage_path?.trim() ? (
            <div key={receipt.id} className="rounded-md border bg-background p-2 space-y-2" role="group" aria-label={`Activation receipt ${index + 1}`}>
              <p className="text-xs text-muted-foreground">Activation {index + 1}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => onViewActivationReceipt(receipt, index)}>
                  <Eye className="w-4 h-4 mr-2" />
                  View
                </Button>
                <Button variant="outline" size="sm" onClick={() => onDownloadActivationReceipt(receipt, index)}>
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          ) : null)}
        </div>
      )}
    </section>
  );
}

function shortBarcode(value: string) {
  if (value.length <= 12) return value;
  return `...${value.slice(-12)}`;
}

function mergePurchase(
  purchase: PrepaidPurchase,
  setActive: Dispatch<SetStateAction<PrepaidPurchase[]>>,
  setArchived: Dispatch<SetStateAction<PrepaidPurchase[]>>,
) {
  const activeCards = purchase.cards.filter((card) => card.state !== "archived");
  const archivedCards = purchase.cards.filter((card) => card.state === "archived");
  setActive((prev) => upsertPurchase(prev, { ...purchase, cards: activeCards }).filter((entry) => entry.cards.length > 0));
  setArchived((prev) => upsertPurchase(prev, { ...purchase, cards: archivedCards }).filter((entry) => entry.cards.length > 0));
}

function upsertPurchase(purchases: PrepaidPurchase[], purchase: PrepaidPurchase) {
  const exists = purchases.some((entry) => entry.id === purchase.id);
  if (!exists) return [purchase, ...purchases];
  return purchases.map((entry) => (entry.id === purchase.id ? purchase : entry));
}

function LoadingState() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
        <CreditCard className="w-7 h-7 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function PrepaidCardDetail({
  entry,
  receipt,
  onViewSalesReceipt,
  onDownloadSalesReceipt,
  onViewActivationReceipt,
  onDownloadActivationReceipt,
  onClose,
  onUpdated,
}: {
  entry: SelectedCard;
  receipt?: Receipt | null;
  onViewSalesReceipt: () => void;
  onDownloadSalesReceipt: () => void;
  onViewActivationReceipt: (receipt: PrepaidActivationReceipt, index: number) => void;
  onDownloadActivationReceipt: (receipt: PrepaidActivationReceipt, index: number) => void;
  onClose: () => void;
  onUpdated: (purchase: PrepaidPurchase) => void;
}) {
  const { uploadPrepaidImage, extractOpenedCard, updateCard, archiveCard, getCardDetail, signCardImage } = usePrepaidApi();
  const [detailCard, setDetailCard] = useState(entry.card);
  const [pan, setPan] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [openedImage, setOpenedImage] = useState<File | null>(null);
  const [openedPreview, setOpenedPreview] = useState<string | null>(null);
  const [openedStoragePath, setOpenedStoragePath] = useState(entry.card.opened_card_image_storage_path || "");
  const [packageImageUrl, setPackageImageUrl] = useState<string | null>(null);
  const [openedSavedImageUrl, setOpenedSavedImageUrl] = useState<string | null>(null);
  const [cardImageModal, setCardImageModal] = useState<ImageModalState | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(true);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    void getCardDetail(entry.purchase.id, entry.card.id)
      .then((card) => {
        if (cancelled) return;
        setDetailCard(card);
        setPan(card.pan || "");
        setExpiry(card.expiry || "");
        setCvv(card.cvv || "");
        setOpenedStoragePath(card.opened_card_image_storage_path || "");
        setPackageImageUrl(null);
        setOpenedSavedImageUrl(null);
        if (card.package_image_storage_path) {
          void signCardImage(entry.purchase.id, entry.card.id, "package")
            .then((url) => {
              if (!cancelled) setPackageImageUrl(url);
            })
            .catch(() => undefined);
        }
        if (card.opened_card_image_storage_path) {
          void signCardImage(entry.purchase.id, entry.card.id, "opened-card")
            .then((url) => {
              if (!cancelled) setOpenedSavedImageUrl(url);
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load card details");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.card.id, entry.purchase.id, getCardDetail, signCardImage]);

  const setImage = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setOpenedImage(file);
    setOpenedStoragePath("");
    setOpenedPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const extract = async () => {
    if (!openedImage && !openedStoragePath) return;
    setBusy(true);
    setWarnings([]);
    try {
      let storagePath = openedStoragePath;
      if (!storagePath && openedImage) {
        const webp = await convertReceiptImageFile(openedImage);
        storagePath = await uploadPrepaidImage(webp, "opened_card");
        setOpenedStoragePath(storagePath);
      }
      const result = await extractOpenedCard(storagePath);
      setPan(result.extraction.pan || "");
      setExpiry(result.extraction.expiry || "");
      setCvv(result.extraction.cvv || "");
      setWarnings(result.warnings || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      let storagePath = openedStoragePath;
      if (!storagePath && openedImage) {
        const webp = await convertReceiptImageFile(openedImage);
        storagePath = await uploadPrepaidImage(webp, "opened_card");
        setOpenedStoragePath(storagePath);
      }
      const purchase = await updateCard(entry.purchase.id, entry.card.id, {
        pan: digitsOnly(pan),
        expiry,
        cvv: digitsOnly(cvv),
        opened_card_image_storage_path: storagePath || undefined,
        confirmed: true,
      });
      toast.success("Card details saved");
      onUpdated(purchase);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save card");
    } finally {
      setBusy(false);
    }
  };

  const markArchived = async () => {
    setBusy(true);
    try {
      const purchase = await archiveCard(entry.purchase.id, entry.card.id);
      toast.success("Card archived");
      onUpdated(purchase);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive card");
    } finally {
      setBusy(false);
    }
  };

  const downloadCardImage = async (kind: "package" | "opened-card") => {
    try {
      await downloadFromSignedURL(() => signCardImage(entry.purchase.id, entry.card.id, kind), cardImageFilename(kind, detailCard));
    } catch {
      toast.error("Failed to download card image");
    }
  };

  const viewCardImage = async (kind: "package" | "opened-card") => {
    const title = kind === "package" ? "Package image" : "Opened-card image";
    try {
      const url = await signCardImage(entry.purchase.id, entry.card.id, kind);
      if (kind === "package") setPackageImageUrl(url);
      else setOpenedSavedImageUrl(url);
      setCardImageModal({ title, url, filename: cardImageFilename(kind, detailCard) });
    } catch {
      toast.error(`${title} is unavailable`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <button onClick={onClose} className="p-2 -ml-2 rounded-md hover:bg-secondary">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">Prepaid Card</h2>
        <Button size="sm" onClick={save} disabled={busy || detailLoading}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <p className="text-sm font-semibold">${(detailCard.denomination ?? 0).toFixed(2)} Vanilla</p>
            <p className="text-xs text-muted-foreground break-all">Package barcode: {detailCard.activation_barcode}</p>
            <p className="text-xs text-muted-foreground">Vanilla serial: {detailCard.vanilla_serial}</p>
            <p className="text-xs text-muted-foreground">State: {detailCard.state === "archived" ? "Archived" : "Active"}</p>
            {receipt?.vendor && <p className="text-xs text-muted-foreground">Retailer: {receipt.vendor}</p>}
          </div>

          <RelatedReceiptActions
            purchase={entry.purchase}
            onViewSalesReceipt={onViewSalesReceipt}
            onDownloadSalesReceipt={onDownloadSalesReceipt}
            onViewActivationReceipt={onViewActivationReceipt}
            onDownloadActivationReceipt={onDownloadActivationReceipt}
          />

          {(detailCard.package_image_storage_path || detailCard.opened_card_image_storage_path) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {detailCard.package_image_storage_path && (
                <SavedCardImage
                  title="Package image"
                  imageUrl={packageImageUrl}
                  onView={() => viewCardImage("package")}
                  onDownload={() => downloadCardImage("package")}
                />
              )}
              {detailCard.opened_card_image_storage_path && (
                <SavedCardImage
                  title="Opened-card image"
                  imageUrl={openedSavedImageUrl}
                  onView={() => viewCardImage("opened-card")}
                  onDownload={() => downloadCardImage("opened-card")}
                />
              )}
            </div>
          )}

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Opened card image</span>
              <Button variant="outline" size="sm" onClick={extract} disabled={busy || detailLoading || (!openedImage && !openedStoragePath)}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanLine className="w-4 h-4 mr-2" />}
                Extract
              </Button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setImage(file);
              event.target.value = "";
            }} />
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setImage(file);
              event.target.value = "";
            }} />
            {openedPreview ? (
              <div className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                <img src={openedPreview} alt="" className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => cameraRef.current?.click()}>
                  <Camera className="w-5 h-5" />
                  Camera
                </Button>
                <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => fileRef.current?.click()}>
                  <Upload className="w-5 h-5" />
                  Gallery
                </Button>
              </div>
            )}
          </div>

          {warnings.length > 0 && (
            <Alert>
              <AlertDescription>{warnings.join(". ")}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Input inputMode="numeric" value={pan} maxLength={16} onChange={(event) => setPan(digitsOnly(event.target.value).slice(0, 16))} placeholder="16-digit PAN" />
            <Input value={expiry} onChange={(event) => setExpiry(event.target.value)} placeholder="Expiry MM/YY" />
            <Input inputMode="numeric" value={cvv} maxLength={4} onChange={(event) => setCvv(digitsOnly(event.target.value).slice(0, 4))} placeholder="CVV" />
          </div>

          {detailCard.state !== "archived" && (
            <Button variant="outline" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10" onClick={markArchived} disabled={busy || detailLoading}>
              <Archive className="w-4 h-4 mr-2" />
              Mark fully used
            </Button>
          )}
        </div>
      </main>
      {cardImageModal && (
        <ImageViewer
          title={cardImageModal.title}
          imageUrl={cardImageModal.url}
          filename={cardImageModal.filename}
          onClose={() => setCardImageModal(null)}
        />
      )}
    </div>
  );
}

function SavedCardImage({
  title,
  imageUrl,
  onView,
  onDownload,
}: {
  title: string;
  imageUrl: string | null;
  onView: () => void;
  onDownload: () => void;
}) {
  return (
    <section className="rounded-lg border bg-card p-3 space-y-3" aria-label={title}>
      <div className="aspect-[4/3] overflow-hidden rounded-md bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{title}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onView}>
            <Eye className="w-4 h-4 mr-2" />
            View
          </Button>
          <Button variant="outline" size="sm" onClick={onDownload}>
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>
        </div>
      </div>
    </section>
  );
}

function SalesReceiptViewer({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const [imageUrl, setImageUrl] = useState<string | null>(receipt.image_url || null);
  const [downloadPending, setDownloadPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (receipt.image_url) return;
    void signedSalesReceiptUrl(receipt.id)
      .then((url) => {
        if (!cancelled) setImageUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [receipt.id, receipt.image_url]);

  const downloadSalesImage = async () => {
    try {
      setDownloadPending(true);
      await downloadFromSignedURL(() => signedSalesReceiptUrl(receipt.id), "sales-receipt.jpg");
    } catch {
      toast.error("Failed to download sales receipt");
    } finally {
      setDownloadPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background animate-fade-in">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <button onClick={onClose} className="p-2 -ml-2 rounded-md hover:bg-secondary">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">Sales Receipt</h2>
        <Button variant="outline" size="sm" onClick={downloadSalesImage} disabled={downloadPending}>
          <Download className="w-4 h-4 mr-2" />
          Download
        </Button>
      </header>
      <main className="flex-1 overflow-y-auto">
        {imageUrl && (
          <div className="aspect-[3/4] max-h-[55vh] bg-muted">
            <img src={imageUrl} alt="Sales receipt" className="h-full w-full object-contain" />
          </div>
        )}
        <div className="max-w-2xl mx-auto p-4 space-y-2">
          <p className="text-base font-semibold">{receipt.vendor || "Receipt"}</p>
          <p className="text-sm text-muted-foreground">{receipt.purchase_date || "Date unavailable"}</p>
          <p className="text-sm tabular-nums">${(receipt.total || 0).toFixed(2)}</p>
        </div>
      </main>
    </div>
  );
}

function ImageViewer({ title, imageUrl, filename, onClose }: { title: string; imageUrl: string; filename: string; onClose: () => void }) {
  const [downloadPending, setDownloadPending] = useState(false);
  const downloadImage = async () => {
    try {
      setDownloadPending(true);
      await downloadFromSignedURL(imageUrl, filename);
    } catch {
      toast.error("Failed to download image");
    } finally {
      setDownloadPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background animate-fade-in">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <button onClick={onClose} className="p-2 -ml-2 rounded-md hover:bg-secondary">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button variant="outline" size="sm" onClick={downloadImage} disabled={downloadPending}>
          <Download className="w-4 h-4 mr-2" />
          Download
        </Button>
      </header>
      <main className="flex-1 bg-muted">
        <img src={imageUrl} alt={title} className="h-full w-full object-contain" />
      </main>
    </div>
  );
}

export default PrepaidCards;
