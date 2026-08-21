import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Camera, Check, Loader2, Plus, ReceiptText, ScanLine, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";
import { useReceiptApi } from "@/hooks/useReceiptApi";
import { PrepaidCardInput, usePrepaidApi } from "@/hooks/usePrepaidApi";
import { cn } from "@/lib/utils";

type Step = 0 | 1 | 2 | 3;

interface AddPrepaidPurchaseFlowProps {
  onClose: () => void;
  onSaved: () => void;
}

interface ImageDraft {
  id: string;
  file: File | null;
  preview: string | null;
  storagePath?: string;
  filename?: string;
  contentType?: string;
}

interface CardDraft extends ImageDraft {
  activationBarcode: string;
  vanillaSerial: string;
  denomination: string;
  warnings: string[];
  isExtracting: boolean;
}

const steps = ["Sales", "Activations", "Cards", "Review"];

function newImageDraft(): ImageDraft {
  return { id: crypto.randomUUID(), file: null, preview: null };
}

function newCardDraft(): CardDraft {
  return {
    ...newImageDraft(),
    activationBarcode: "",
    vanillaSerial: "",
    denomination: "",
    warnings: [],
    isExtracting: false,
  };
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function revokeDraft(draft: ImageDraft) {
  if (draft.preview) URL.revokeObjectURL(draft.preview);
}

function moneyOrUndefined(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function AddPrepaidPurchaseFlow({ onClose, onSaved }: AddPrepaidPurchaseFlowProps) {
  const [step, setStep] = useState<Step>(0);
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [salesPreview, setSalesPreview] = useState<string | null>(null);
  const [salesReceiptID, setSalesReceiptID] = useState<string | null>(null);
  const [salesReceiptUploading, setSalesReceiptUploading] = useState(false);
  const [activationReceipts, setActivationReceipts] = useState<ImageDraft[]>([newImageDraft()]);
  const [cards, setCards] = useState<CardDraft[]>([newCardDraft()]);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const salesCameraRef = useRef<HTMLInputElement>(null);
  const salesFileRef = useRef<HTMLInputElement>(null);
  const { createReceiptViaSignedUpload } = useReceiptApi({ pollingPaused: true });
  const { uploadPrepaidImage, extractPackage, createPurchase } = usePrepaidApi();

  const canContinue = useMemo(() => {
    if (step === 0) return !!salesFile || !!salesReceiptID;
    if (step === 1) return activationReceipts.some((item) => item.file || item.storagePath);
    if (step === 2) {
      return cards.some((card) => card.file || card.storagePath)
        && cards.every((card) => {
          const hasAny = card.file || card.storagePath || card.activationBarcode || card.vanillaSerial || card.denomination;
          if (!hasAny) return true;
          return digitsOnly(card.activationBarcode).length === 30
            && digitsOnly(card.vanillaSerial).length === 11
            && moneyOrUndefined(card.denomination) !== undefined;
        });
    }
    return true;
  }, [activationReceipts, cards, salesFile, salesReceiptID, step]);

  const setSalesImage = (file: File) => {
    if (salesReceiptID) {
      setSubmitError("The sales receipt is already saved and cannot be replaced from this flow.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setSubmitError("Only image files are allowed.");
      return;
    }
    setSubmitError(null);
    setSalesFile(file);
    setSalesPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const ensureSalesReceipt = async () => {
    if (salesReceiptID) return salesReceiptID;
    if (!salesFile) throw new Error("Sales receipt is required.");
    setSalesReceiptUploading(true);
    try {
      const salesWebp = await convertReceiptImageFile(salesFile);
      const salesReceipt = (await createReceiptViaSignedUpload(salesWebp)) as { id?: unknown };
      const nextSalesReceiptID = typeof salesReceipt.id === "string" ? salesReceipt.id : "";
      if (!nextSalesReceiptID) throw new Error("Sales receipt upload did not return a receipt ID.");
      setSalesReceiptID(nextSalesReceiptID);
      return nextSalesReceiptID;
    } finally {
      setSalesReceiptUploading(false);
    }
  };

  const continueFlow = async () => {
    if (step === 0 && !salesReceiptID) {
      setSubmitError(null);
      try {
        await ensureSalesReceipt();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save sales receipt";
        setSubmitError(message);
        toast.error(message);
        return;
      }
    }
    setStep((Math.min(3, step + 1) as Step));
  };

  const updateActivationFile = (id: string, file: File) => {
    if (!file.type.startsWith("image/")) return;
    setActivationReceipts((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        revokeDraft(item);
        return {
          ...item,
          file,
          preview: URL.createObjectURL(file),
          filename: file.name,
          contentType: file.type,
          storagePath: undefined,
        };
      }),
    );
  };

  const updateCardFile = (id: string, file: File) => {
    if (!file.type.startsWith("image/")) return;
    setCards((prev) =>
      prev.map((card) => {
        if (card.id !== id) return card;
        revokeDraft(card);
        return {
          ...card,
          file,
          preview: URL.createObjectURL(file),
          filename: file.name,
          contentType: file.type,
          storagePath: undefined,
          warnings: [],
        };
      }),
    );
  };

  const extractCard = async (cardID: string) => {
    const card = cards.find((entry) => entry.id === cardID);
    if (!card?.file && !card?.storagePath) return;
    setCards((prev) => prev.map((entry) => (entry.id === cardID ? { ...entry, isExtracting: true, warnings: [] } : entry)));
    try {
      let storagePath = card.storagePath;
      if (!storagePath && card.file) {
        const webp = await convertReceiptImageFile(card.file);
        storagePath = await uploadPrepaidImage(webp, "package");
      }
      if (!storagePath) throw new Error("Package image is missing");
      const result = await extractPackage(storagePath);
      setCards((prev) =>
        prev.map((entry) =>
          entry.id === cardID
            ? {
                ...entry,
                storagePath,
                activationBarcode: result.extraction.activation_barcode || entry.activationBarcode,
                vanillaSerial: result.extraction.serial_number || entry.vanillaSerial,
                denomination: result.extraction.denomination != null ? String(result.extraction.denomination) : entry.denomination,
                warnings: result.warnings || [],
                isExtracting: false,
              }
            : entry,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Extraction failed";
      toast.error(message);
      setCards((prev) => prev.map((entry) => (entry.id === cardID ? { ...entry, isExtracting: false } : entry)));
    }
  };

  const closeAndCleanup = () => {
    if (salesPreview) URL.revokeObjectURL(salesPreview);
    activationReceipts.forEach(revokeDraft);
    cards.forEach(revokeDraft);
    onClose();
  };

  const savePurchase = async () => {
    setIsSaving(true);
    setSubmitError(null);
    try {
      const savedSalesReceiptID = await ensureSalesReceipt();

      const uploadedActivations = [];
      for (const item of activationReceipts) {
        if (!item.file && !item.storagePath) continue;
        let storagePath = item.storagePath;
        if (!storagePath && item.file) {
          const webp = await convertReceiptImageFile(item.file);
          storagePath = await uploadPrepaidImage(webp, "activation_receipt");
          setActivationReceipts((prev) =>
            prev.map((entry) => (entry.id === item.id ? { ...entry, storagePath } : entry)),
          );
        }
        if (storagePath) {
          uploadedActivations.push({
            storage_path: storagePath,
            filename: item.filename || item.file?.name || "activation-receipt.webp",
            content_type: "image/webp",
          });
        }
      }

      const cardPayload: PrepaidCardInput[] = [];
      for (const card of cards) {
        const hasAny = card.file || card.storagePath || card.activationBarcode || card.vanillaSerial || card.denomination;
        if (!hasAny) continue;
        let storagePath = card.storagePath;
        if (!storagePath && card.file) {
          const webp = await convertReceiptImageFile(card.file);
          storagePath = await uploadPrepaidImage(webp, "package");
          setCards((prev) =>
            prev.map((entry) => (entry.id === card.id ? { ...entry, storagePath } : entry)),
          );
        }
        cardPayload.push({
          activation_barcode: digitsOnly(card.activationBarcode),
          vanilla_serial: digitsOnly(card.vanillaSerial),
          denomination: moneyOrUndefined(card.denomination),
          package_image_storage_path: storagePath,
          confirmed: true,
        });
      }

      await createPurchase({
        sales_receipt_id: savedSalesReceiptID,
        activation_receipts: uploadedActivations,
        cards: cardPayload,
      });
      toast.success("Prepaid purchase saved");
      onSaved();
      closeAndCleanup();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save prepaid purchase";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <button onClick={closeAndCleanup} className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors">
          <X className="w-5 h-5" />
        </button>
        <div className="text-center">
          <h2 className="text-sm font-semibold">Add Purchase</h2>
          <p className="text-xs text-muted-foreground">{steps[step]}</p>
        </div>
        <Button size="sm" onClick={step === 3 ? savePurchase : continueFlow} disabled={!canContinue || isSaving || salesReceiptUploading}>
          {isSaving || salesReceiptUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : step === 3 ? "Save" : "Next"}
        </Button>
      </header>

      <div className="border-b px-4 py-3">
        <div className="max-w-2xl mx-auto grid grid-cols-4 gap-2">
          {steps.map((label, index) => (
            <button
              key={label}
              onClick={() => setStep(index as Step)}
              className={cn(
                "h-1.5 rounded-full transition-colors",
                index <= step ? "bg-primary" : "bg-muted",
              )}
              aria-label={label}
            />
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-4">
          {submitError && (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          {step === 0 && (
            <section className="space-y-4">
              <input ref={salesCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setSalesImage(file);
                event.target.value = "";
              }} />
              <input ref={salesFileRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setSalesImage(file);
                event.target.value = "";
              }} />
              {salesPreview ? (
                <ImagePreview preview={salesPreview} onClear={() => {
                  if (salesReceiptID) return;
                  setSalesFile(null);
                  setSalesPreview((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                }} locked={!!salesReceiptID} />
              ) : (
                <CaptureChoices onCamera={() => salesCameraRef.current?.click()} onGallery={() => salesFileRef.current?.click()} />
              )}
              {salesReceiptID && (
                <Alert>
                  <AlertDescription>Sales receipt saved in Receipt Keeper. Retries will reuse this receipt.</AlertDescription>
                </Alert>
              )}
              <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                The sales receipt is uploaded through normal Receipt Keeper and will appear in your regular receipt list.
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="space-y-3">
              {activationReceipts.map((item, index) => (
                <ImageSlot
                  key={item.id}
                  title={`Activation receipt ${index + 1}`}
                  draft={item}
                  onFile={(file) => updateActivationFile(item.id, file)}
                  onRemove={() => {
                    setActivationReceipts((prev) => {
                      const target = prev.find((entry) => entry.id === item.id);
                      if (target) revokeDraft(target);
                      const next = prev.filter((entry) => entry.id !== item.id);
                      return next.length > 0 ? next : [newImageDraft()];
                    });
                  }}
                />
              ))}
              <Button variant="outline" className="w-full" onClick={() => setActivationReceipts((prev) => [...prev, newImageDraft()])}>
                <Plus className="w-4 h-4 mr-2" />
                Add another activation receipt
              </Button>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-4">
              {cards.map((card, index) => (
                <CardCapture
                  key={card.id}
                  index={index}
                  card={card}
                  onFile={(file) => updateCardFile(card.id, file)}
                  onChange={(updates) => setCards((prev) => prev.map((entry) => (entry.id === card.id ? { ...entry, ...updates } : entry)))}
                  onExtract={() => extractCard(card.id)}
                  onRemove={() => {
                    setCards((prev) => {
                      const target = prev.find((entry) => entry.id === card.id);
                      if (target) revokeDraft(target);
                      const next = prev.filter((entry) => entry.id !== card.id);
                      return next.length > 0 ? next : [newCardDraft()];
                    });
                  }}
                />
              ))}
              <Button variant="outline" className="w-full" onClick={() => setCards((prev) => [...prev, newCardDraft()])}>
                <Plus className="w-4 h-4 mr-2" />
                Add another card
              </Button>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-3">
              <ReviewRow icon={<ReceiptText className="w-4 h-4" />} label="Sales receipt" value={salesReceiptID ? "Saved in Receipt Keeper" : salesFile?.name || "Missing"} />
              <ReviewRow icon={<ScanLine className="w-4 h-4" />} label="Activation receipts" value={String(activationReceipts.filter((item) => item.file || item.storagePath).length)} />
              {cards.filter((card) => card.activationBarcode || card.vanillaSerial).map((card, index) => (
                <div key={card.id} className="rounded-lg border bg-card p-4 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">Card {index + 1}</span>
                    <span className="text-sm tabular-nums">${moneyOrUndefined(card.denomination)?.toFixed(2) || "0.00"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground break-all">Package barcode: {digitsOnly(card.activationBarcode)}</p>
                  <p className="text-xs text-muted-foreground">Vanilla serial: {digitsOnly(card.vanillaSerial)}</p>
                </div>
              ))}
            </section>
          )}
        </div>
      </main>

      <footer className="border-t px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <Button variant="outline" onClick={() => setStep((Math.max(0, step - 1) as Step))} disabled={step === 0 || isSaving}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button onClick={step === 3 ? savePurchase : continueFlow} disabled={!canContinue || isSaving || salesReceiptUploading}>
            {isSaving || salesReceiptUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : step === 3 ? <Check className="w-4 h-4 mr-2" /> : null}
            {step === 3 ? "Save purchase" : "Continue"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function CaptureChoices({ onCamera, onGallery }: { onCamera: () => void; onGallery: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button onClick={onCamera} className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-10 hover:bg-secondary/50">
        <Camera className="w-6 h-6 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Camera</span>
      </button>
      <button onClick={onGallery} className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-10 hover:bg-secondary/50">
        <Upload className="w-6 h-6 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Gallery</span>
      </button>
    </div>
  );
}

function ImagePreview({ preview, onClear, locked = false }: { preview: string; onClear: () => void; locked?: boolean }) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted ring-1 ring-border">
      <img src={preview} alt="" className="h-full w-full object-cover" />
      {!locked && (
        <button onClick={onClear} className="absolute right-2 top-2 rounded-md bg-card/90 p-1.5">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function ImageSlot({ title, draft, onFile, onRemove }: { title: string; draft: ImageDraft; onFile: (file: File) => void; onRemove: () => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <button onClick={onRemove} className="p-1 rounded-md hover:bg-secondary">
          <X className="w-4 h-4" />
        </button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onFile(file);
        event.target.value = "";
      }} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onFile(file);
        event.target.value = "";
      }} />
      {draft.preview ? <ImagePreview preview={draft.preview} onClear={onRemove} /> : <CaptureChoices onCamera={() => cameraRef.current?.click()} onGallery={() => fileRef.current?.click()} />}
    </div>
  );
}

function CardCapture({
  index,
  card,
  onFile,
  onChange,
  onExtract,
  onRemove,
}: {
  index: number;
  card: CardDraft;
  onFile: (file: File) => void;
  onChange: (updates: Partial<CardDraft>) => void;
  onExtract: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Card/package {index + 1}</span>
        <button onClick={onRemove} className="p-1 rounded-md hover:bg-secondary">
          <X className="w-4 h-4" />
        </button>
      </div>
      <ImageSlot title="Package image" draft={card} onFile={onFile} onRemove={onRemove} />
      <Button type="button" variant="outline" className="w-full" onClick={onExtract} disabled={card.isExtracting || (!card.file && !card.storagePath)}>
        {card.isExtracting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanLine className="w-4 h-4 mr-2" />}
        Extract package details
      </Button>
      {card.warnings.length > 0 && (
        <Alert>
          <AlertDescription>{card.warnings.join(". ")}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Input inputMode="numeric" value={card.activationBarcode} maxLength={30} onChange={(event) => onChange({ activationBarcode: digitsOnly(event.target.value).slice(0, 30) })} placeholder="30-digit package barcode" />
        <Input inputMode="numeric" value={card.vanillaSerial} maxLength={11} onChange={(event) => onChange({ vanillaSerial: digitsOnly(event.target.value).slice(0, 11) })} placeholder="11-digit Vanilla serial" />
        <Input inputMode="decimal" value={card.denomination} onChange={(event) => onChange({ denomination: event.target.value })} placeholder="Denomination" />
      </div>
      {card.activationBarcode && <p className="text-xs text-muted-foreground break-all">Linked package barcode: {digitsOnly(card.activationBarcode)}</p>}
    </div>
  );
}

function ReviewRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{value}</p>
      </div>
    </div>
  );
}
