import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Archive, Camera, CreditCard, FileImage, Loader2, Plus, ReceiptText, RefreshCw, ScanLine, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AddPrepaidPurchaseFlow } from "@/components/prepaid/AddPrepaidPurchaseFlow";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";
import { Receipt, useReceiptApi } from "@/hooks/useReceiptApi";
import { PrepaidActivationReceipt, PrepaidCard, PrepaidPurchase, usePrepaidApi, usePrepaidStatus } from "@/hooks/usePrepaidApi";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";
import { formatReceiptPurchaseDate } from "@/lib/receiptDate";

interface SelectedCard {
  purchase: PrepaidPurchase;
  card: PrepaidCard;
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

const PrepaidCards = () => {
  const navigate = useNavigate();
  const { enabled, isLoading: statusLoading } = usePrepaidStatus();
  const { listPurchases, signActivationReceiptImage } = usePrepaidApi();
  const { fetchReceipt } = useReceiptApi({ pollingPaused: true });
  const [activePurchases, setActivePurchases] = useState<PrepaidPurchase[]>([]);
  const [archivedPurchases, setArchivedPurchases] = useState<PrepaidPurchase[]>([]);
  const [receiptMap, setReceiptMap] = useState<Record<string, Receipt | null>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showAddFlow, setShowAddFlow] = useState(false);
  const [selected, setSelected] = useState<SelectedCard | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Receipt | null>(null);
  const [activationImage, setActivationImage] = useState<{ title: string; url: string } | null>(null);

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
      setActivationImage({ title: `Activation receipt ${index + 1}`, url });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Activation receipt image is unavailable");
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
                  onViewActivationReceipt={(receipt, index) => openActivationReceipt(purchase.id, receipt, index)}
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
                  onViewActivationReceipt={(receipt, index) => openActivationReceipt(purchase.id, receipt, index)}
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
          onClose={() => setSelected(null)}
          onUpdated={(purchase) => {
            setSelected(null);
            mergePurchase(purchase, setActivePurchases, setArchivedPurchases);
            void load();
          }}
        />
      )}

      {viewingReceipt && <SalesReceiptViewer receipt={viewingReceipt} onClose={() => setViewingReceipt(null)} />}
      {activationImage && <ImageViewer title={activationImage.title} imageUrl={activationImage.url} onClose={() => setActivationImage(null)} />}
    </div>
  );
};

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
  onViewActivationReceipt,
}: {
  purchase: PrepaidPurchase;
  receipt?: Receipt | null;
  onCardClick: (card: PrepaidCard) => void;
  onViewSalesReceipt: () => void;
  onViewActivationReceipt: (receipt: PrepaidActivationReceipt, index: number) => void;
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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onViewSalesReceipt}>
            <ReceiptText className="w-4 h-4 mr-2" />
            View sales receipt
          </Button>
          <span className="inline-flex h-9 items-center rounded-md border px-3 text-xs text-muted-foreground">
            Activation receipts ({purchase.activation_receipts.length})
          </span>
        </div>
        {purchase.activation_receipts.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {purchase.activation_receipts.map((activationReceipt, index) => (
              <button
                key={activationReceipt.id}
                onClick={() => onViewActivationReceipt(activationReceipt, index)}
                className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-xs hover:bg-secondary"
              >
                <FileImage className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">Activation {index + 1}</span>
              </button>
            ))}
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

function PrepaidCardDetail({ entry, onClose, onUpdated }: { entry: SelectedCard; onClose: () => void; onUpdated: (purchase: PrepaidPurchase) => void }) {
  const { uploadPrepaidImage, extractOpenedCard, updateCard, archiveCard, getCardDetail } = usePrepaidApi();
  const [detailCard, setDetailCard] = useState(entry.card);
  const [pan, setPan] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [openedImage, setOpenedImage] = useState<File | null>(null);
  const [openedPreview, setOpenedPreview] = useState<string | null>(null);
  const [openedStoragePath, setOpenedStoragePath] = useState(entry.card.opened_card_image_storage_path || "");
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
  }, [entry.card.id, entry.purchase.id, getCardDetail]);

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
          </div>

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
    </div>
  );
}

function SalesReceiptViewer({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const [imageUrl, setImageUrl] = useState<string | null>(receipt.image_url || null);

  useEffect(() => {
    let cancelled = false;
    if (receipt.image_url) return;
    void apiFetch(`${API_BASE_URL}/receipts/sign-image`, {
      method: "POST",
      body: JSON.stringify({ receipt_id: receipt.id }),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { image_url?: string } | null) => {
        if (!cancelled && payload?.image_url) setImageUrl(payload.image_url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [receipt.id, receipt.image_url]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background animate-fade-in">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <button onClick={onClose} className="p-2 -ml-2 rounded-md hover:bg-secondary">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">Sales Receipt</h2>
        <span className="w-9" />
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

function ImageViewer({ title, imageUrl, onClose }: { title: string; imageUrl: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background animate-fade-in">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <button onClick={onClose} className="p-2 -ml-2 rounded-md hover:bg-secondary">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="w-9" />
      </header>
      <main className="flex-1 bg-muted">
        <img src={imageUrl} alt={title} className="h-full w-full object-contain" />
      </main>
    </div>
  );
}

export default PrepaidCards;
