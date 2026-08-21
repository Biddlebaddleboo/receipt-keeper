import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Archive, Camera, CreditCard, Loader2, Plus, RefreshCw, ScanLine, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AddPrepaidPurchaseFlow } from "@/components/prepaid/AddPrepaidPurchaseFlow";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";
import { PrepaidCard, PrepaidPurchase, usePrepaidApi, usePrepaidStatus } from "@/hooks/usePrepaidApi";

interface FlattenedCard {
  purchase: PrepaidPurchase;
  card: PrepaidCard;
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

const PrepaidCards = () => {
  const navigate = useNavigate();
  const { enabled, isLoading: statusLoading } = usePrepaidStatus();
  const { listPurchases } = usePrepaidApi();
  const [activePurchases, setActivePurchases] = useState<PrepaidPurchase[]>([]);
  const [archivedPurchases, setArchivedPurchases] = useState<PrepaidPurchase[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddFlow, setShowAddFlow] = useState(false);
  const [selected, setSelected] = useState<FlattenedCard | null>(null);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load prepaid cards";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, listPurchases]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCards = useMemo(() => flattenCards(activePurchases), [activePurchases]);
  const archivedCards = useMemo(() => flattenCards(archivedPurchases), [archivedPurchases]);

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
            {isLoading && activeCards.length === 0 ? (
              <LoadingState />
            ) : activeCards.length === 0 ? (
              <EmptyState label="No active prepaid cards" />
            ) : (
              activeCards.map((entry) => (
                <PrepaidCardRow key={`${entry.purchase.id}:${entry.card.id}`} entry={entry} onClick={() => setSelected(entry)} />
              ))
            )}
          </TabsContent>
          <TabsContent value="archive" className="space-y-3">
            {isLoading && archivedCards.length === 0 ? (
              <LoadingState />
            ) : archivedCards.length === 0 ? (
              <EmptyState label="No archived prepaid cards" />
            ) : (
              archivedCards.map((entry) => (
                <PrepaidCardRow key={`${entry.purchase.id}:${entry.card.id}`} entry={entry} onClick={() => setSelected(entry)} />
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

function flattenCards(purchases: PrepaidPurchase[]): FlattenedCard[] {
  return purchases.flatMap((purchase) => purchase.cards.map((card) => ({ purchase, card })));
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

function PrepaidCardRow({ entry, onClick }: { entry: FlattenedCard; onClick: () => void }) {
  const card = entry.card;
  return (
    <button onClick={onClick} className="w-full rounded-lg border bg-card p-4 text-left receipt-shadow transition-colors hover:bg-secondary/50 active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">${(card.denomination ?? 0).toFixed(2)}</span>
            {card.state === "archived" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Archived</span>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground break-all">Package barcode: {card.activation_barcode}</p>
          <p className="text-xs text-muted-foreground">Vanilla serial: {card.vanilla_serial}</p>
        </div>
      </div>
    </button>
  );
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

function PrepaidCardDetail({ entry, onClose, onUpdated }: { entry: FlattenedCard; onClose: () => void; onUpdated: (purchase: PrepaidPurchase) => void }) {
  const { uploadPrepaidImage, extractOpenedCard, updateCard, archiveCard } = usePrepaidApi();
  const [pan, setPan] = useState(entry.card.pan || "");
  const [expiry, setExpiry] = useState(entry.card.expiry || "");
  const [cvv, setCvv] = useState(entry.card.cvv || "");
  const [openedImage, setOpenedImage] = useState<File | null>(null);
  const [openedPreview, setOpenedPreview] = useState<string | null>(null);
  const [openedStoragePath, setOpenedStoragePath] = useState(entry.card.opened_card_image_storage_path || "");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <p className="text-sm font-semibold">${(entry.card.denomination ?? 0).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground break-all">Package barcode: {entry.card.activation_barcode}</p>
            <p className="text-xs text-muted-foreground">Vanilla serial: {entry.card.vanilla_serial}</p>
          </div>

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Opened card image</span>
              <Button variant="outline" size="sm" onClick={extract} disabled={busy || (!openedImage && !openedStoragePath)}>
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

          {entry.card.state !== "archived" && (
            <Button variant="outline" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10" onClick={markArchived} disabled={busy}>
              <Archive className="w-4 h-4 mr-2" />
              Mark fully used
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

export default PrepaidCards;
