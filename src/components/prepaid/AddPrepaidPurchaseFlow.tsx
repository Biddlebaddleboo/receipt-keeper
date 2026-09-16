import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Camera, Check, Loader2, Plus, ReceiptText, ScanLine, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useReceiptApi } from "@/hooks/useReceiptApi";
import type { PrepaidCardInput, PrepaidImageType } from "@/hooks/usePrepaidApi";
import { usePrepaidApi } from "@/hooks/usePrepaidApi";
import { cn } from "@/lib/utils";
import { BrowserCamera, type CameraColorMode } from "@/components/BrowserCamera";
import { convertImageFileToGrayscale } from "@/lib/nativeImageConverter";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";
import { prepareAndUploadPrepaidImage } from "@/lib/prepaidImagePipeline";

type Step = 0 | 1 | 2 | 3;
type CardSide = "front" | "back";
type SideStatus = "idle" | "preparing" | "extracting" | "ready" | "warning" | "error";

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
  imageGrayscale?: boolean;
}

interface SideDraft extends ImageDraft {
  status: SideStatus;
  warnings: string[];
  isExtracting: boolean;
}

interface CardDraft {
  id: string;
  packageImage: ImageDraft;
  packageWarnings: string[];
  packageIsExtracting: boolean;
  activationBarcode: string;
  vanillaSerial: string;
  denomination: string;
  activationReceiptId: string;
  front: SideDraft;
  back: SideDraft;
  pan: string;
  expiry: string;
  cvv: string;
  packageManualVersion: number;
  panManualVersion: number;
  expiryManualVersion: number;
  cvvManualVersion: number;
}

const steps = ["Sales", "Activations", "Cards", "Review"];

function newImageDraft(): ImageDraft {
  return { id: crypto.randomUUID(), file: null, preview: null };
}

function newSideDraft(): SideDraft {
  return { ...newImageDraft(), status: "idle", warnings: [], isExtracting: false };
}

function newCardDraft(): CardDraft {
  return {
    id: crypto.randomUUID(),
    packageImage: newImageDraft(),
    packageWarnings: [],
    packageIsExtracting: false,
    activationBarcode: "",
    vanillaSerial: "",
    denomination: "",
    activationReceiptId: "",
    front: newSideDraft(),
    back: newSideDraft(),
    pan: "",
    expiry: "",
    cvv: "",
    packageManualVersion: 0,
    panManualVersion: 0,
    expiryManualVersion: 0,
    cvvManualVersion: 0,
  };
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function revokeDraft(draft: ImageDraft) {
  if (draft.preview) URL.revokeObjectURL(draft.preview);
}

function revokeCardDraft(card: CardDraft) {
  revokeDraft(card.packageImage);
  revokeDraft(card.front);
  revokeDraft(card.back);
}

function moneyOrUndefined(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasDraftImage(draft: ImageDraft) {
  return Boolean(draft.file || draft.storagePath);
}

function hasCardContent(card: CardDraft) {
  return Boolean(
    hasDraftImage(card.packageImage)
    || hasDraftImage(card.front)
    || hasDraftImage(card.back)
    || card.activationBarcode
    || card.vanillaSerial
    || card.denomination,
  );
}

export function AddPrepaidPurchaseFlow({ onClose, onSaved }: AddPrepaidPurchaseFlowProps) {
  const [step, setStep] = useState<Step>(0);
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [salesPreview, setSalesPreview] = useState<string | null>(null);
  const [salesReceiptID, setSalesReceiptID] = useState<string | null>(null);
  const [salesReceiptUploading, setSalesReceiptUploading] = useState(false);
  const [salesImageGrayscale, setSalesImageGrayscale] = useState(false);
  const [activationReceipts, setActivationReceipts] = useState<ImageDraft[]>([]);
  const [cards, setCards] = useState<CardDraft[]>([newCardDraft()]);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const salesFileRef = useRef<HTMLInputElement>(null);
  const sideGenerationsRef = useRef<Record<string, number>>({});
  const sidePromisesRef = useRef<Record<string, Promise<string | undefined>>>({});
  const [salesCameraOpen, setSalesCameraOpen] = useState(false);
  const { createReceiptViaSignedUpload } = useReceiptApi({ pollingPaused: true });
  const {
    uploadPrepaidImage,
    extractPackage,
    extractCardFront,
    extractCardBack,
    createPurchase,
  } = usePrepaidApi();

  const canContinue = useMemo(() => {
    if (step === 0) return !!salesFile || !!salesReceiptID;
    if (step === 1) return true;
    if (step === 2) {
      return cards.some(hasCardContent) && cards.every((card) => {
        if (!hasCardContent(card)) return true;
        return digitsOnly(card.activationBarcode).length === 30
          && digitsOnly(card.vanillaSerial).length === 11
          && moneyOrUndefined(card.denomination) !== undefined;
      });
    }
    return true;
  }, [cards, salesFile, salesReceiptID, step]);

  const setSalesImage = (file: File, colorMode: CameraColorMode = "color") => {
    if (salesReceiptID) {
      setSubmitError("The sales receipt is already saved and cannot be replaced from this flow.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setSubmitError("Only image files are allowed.");
      return;
    }
    setSubmitError(null);
    setSalesImageGrayscale(colorMode === "grayscale");
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
      const salesSource = salesImageGrayscale ? await convertImageFileToGrayscale(salesFile) : salesFile;
      const salesWebp = await convertReceiptImageFile(salesSource);
      if (salesWebp.type.toLowerCase() !== "image/webp") throw new Error("Sales receipt conversion must return WebP.");
      const salesReceipt = (await createReceiptViaSignedUpload(
        salesWebp,
        salesImageGrayscale ? { image_grayscale: true } : undefined,
      )) as { id?: unknown };
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
    setStep(Math.min(3, step + 1) as Step);
  };

  const updateActivationFile = (id: string, file: File, colorMode: CameraColorMode = "color") => {
    if (!file.type.startsWith("image/")) return;
    setActivationReceipts((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      revokeDraft(item);
      return {
        ...item,
        file,
        preview: URL.createObjectURL(file),
        filename: file.name,
        contentType: file.type,
        imageGrayscale: colorMode === "grayscale",
        storagePath: undefined,
      };
    }));
  };

  const clearActivationFile = (id: string) => {
    setActivationReceipts((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      revokeDraft(item);
      return { ...item, file: null, preview: null, storagePath: undefined, filename: undefined, contentType: undefined };
    }));
    setCards((prev) => prev.map((card) => card.activationReceiptId === id ? { ...card, activationReceiptId: "" } : card));
  };

  const updatePackageFile = (id: string, file: File, colorMode: CameraColorMode = "color") => {
    if (!file.type.startsWith("image/")) return;
    setCards((prev) => prev.map((card) => {
      if (card.id !== id) return card;
      revokeDraft(card.packageImage);
      const packageImage = newImageDraft();
      return {
        ...card,
        packageImage: { ...packageImage, file, preview: URL.createObjectURL(file), filename: file.name, contentType: file.type, imageGrayscale: colorMode === "grayscale" },
        packageWarnings: [],
      };
    }));
  };

  const clearPackage = (id: string) => {
    setCards((prev) => prev.map((card) => {
      if (card.id !== id) return card;
      revokeDraft(card.packageImage);
      return { ...card, packageImage: newImageDraft(), packageWarnings: [] };
    }));
  };

  const isCurrentSide = (cardID: string, side: CardSide, generation: number) =>
    sideGenerationsRef.current[`${cardID}:${side}`] === generation;

  const setSideState = (cardID: string, side: CardSide, update: (draft: SideDraft) => SideDraft) => {
    setCards((prev) => prev.map((card) => (card.id === cardID ? { ...card, [side]: update(card[side]) } : card)));
  };

  const processCardSide = async (
    cardID: string,
    side: CardSide,
    file: File,
    grayscale: boolean,
    generation: number,
  ): Promise<string | undefined> => {
    const imageType: PrepaidImageType = side === "front" ? "card_front" : "card_back";
    const cardAtStart = cards.find((card) => card.id === cardID);
    const panEditVersionAtStart = cardAtStart?.panManualVersion ?? 0;
    const expiryEditVersionAtStart = cardAtStart?.expiryManualVersion ?? 0;
    const cvvEditVersionAtStart = cardAtStart?.cvvManualVersion ?? 0;
    let uploadedStoragePath: string | undefined;
    try {
      const result = await prepareAndUploadPrepaidImage(file, imageType, { grayscale, upload: uploadPrepaidImage });
      const storagePath = result.storagePath;
      if (!storagePath) throw new Error(`${side === "front" ? "Front" : "Back"} image upload did not return a storage path.`);
      uploadedStoragePath = storagePath;
      if (!isCurrentSide(cardID, side, generation)) return storagePath;
      setSideState(cardID, side, (draft) => {
        if (draft.preview) URL.revokeObjectURL(draft.preview);
        return { ...draft, preview: URL.createObjectURL(result.file), storagePath, status: "extracting" };
      });

      const extraction = side === "front" ? await extractCardFront(storagePath) : await extractCardBack(storagePath);
      if (!isCurrentSide(cardID, side, generation)) return storagePath;
      setCards((prev) => prev.map((card) => {
        if (card.id !== cardID) return card;
        const next = {
          ...card,
          [side]: {
            ...card[side],
            storagePath,
            status: extraction.warnings?.length ? "warning" : "ready",
            warnings: extraction.warnings || [],
            isExtracting: false,
          },
        } as CardDraft;
        if (side === "front") {
          const frontExtraction = extraction as Awaited<ReturnType<typeof extractCardFront>>;
          if (card.panManualVersion === panEditVersionAtStart) {
            next.pan = frontExtraction.extraction.pan || next.pan;
          }
          if (card.expiryManualVersion === expiryEditVersionAtStart) {
            next.expiry = frontExtraction.extraction.expiry || next.expiry;
          }
        } else {
          const backExtraction = extraction as Awaited<ReturnType<typeof extractCardBack>>;
          if (card.cvvManualVersion === cvvEditVersionAtStart) {
            next.cvv = backExtraction.extraction.cvv || next.cvv;
          }
        }
        return next;
      }));
      return storagePath;
    } catch (error) {
      if (isCurrentSide(cardID, side, generation)) {
        const message = error instanceof Error ? error.message : `${side === "front" ? "Front" : "Back"} extraction failed`;
        setSideState(cardID, side, (draft) => ({ ...draft, status: "error", warnings: [message], isExtracting: false }));
        toast.error(message);
      }
      return uploadedStoragePath;
    }
  };

  const updateCardSideFile = (cardID: string, side: CardSide, file: File, colorMode: CameraColorMode = "color") => {
    if (!file.type.startsWith("image/")) return;
    const key = `${cardID}:${side}`;
    const generation = (sideGenerationsRef.current[key] ?? 0) + 1;
    sideGenerationsRef.current[key] = generation;
    setCards((prev) => prev.map((card) => {
      if (card.id !== cardID) return card;
      const previous = card[side];
      revokeDraft(previous);
      return {
        ...card,
        [side]: {
          ...previous,
          file,
          preview: URL.createObjectURL(file),
          filename: file.name,
          contentType: file.type,
          imageGrayscale: colorMode === "grayscale",
          storagePath: undefined,
          status: "preparing",
          warnings: [],
          isExtracting: true,
        },
      };
    }));
    const promise = processCardSide(cardID, side, file, colorMode === "grayscale", generation);
    sidePromisesRef.current[key] = promise;
    void promise.finally(() => {
      if (sidePromisesRef.current[key] === promise) delete sidePromisesRef.current[key];
    });
  };

  const retryCardSide = (cardID: string, side: CardSide) => {
    const card = cards.find((entry) => entry.id === cardID);
    const draft = card?.[side];
    if (!draft?.storagePath) {
      if (draft?.file) updateCardSideFile(cardID, side, draft.file, draft.imageGrayscale ? "grayscale" : "color");
      return;
    }
    const key = `${cardID}:${side}`;
    const generation = sideGenerationsRef.current[key] ?? 0;
    const panEditVersionAtStart = card?.panManualVersion ?? 0;
    const expiryEditVersionAtStart = card?.expiryManualVersion ?? 0;
    const cvvEditVersionAtStart = card?.cvvManualVersion ?? 0;
    setSideState(cardID, side, (entry) => ({ ...entry, status: "extracting", warnings: [], isExtracting: true }));
    const extractionPromise = (async () => {
      try {
        const result = side === "front" ? await extractCardFront(draft.storagePath!) : await extractCardBack(draft.storagePath!);
        if (!isCurrentSide(cardID, side, generation)) return draft.storagePath;
        setCards((prev) => prev.map((entry) => {
          if (entry.id !== cardID) return entry;
          const next = { ...entry, [side]: { ...entry[side], status: result.warnings?.length ? "warning" : "ready", warnings: result.warnings || [], isExtracting: false } } as CardDraft;
          if (side === "front") {
            const frontResult = result as Awaited<ReturnType<typeof extractCardFront>>;
            if (entry.panManualVersion === panEditVersionAtStart) {
              next.pan = frontResult.extraction.pan || next.pan;
            }
            if (entry.expiryManualVersion === expiryEditVersionAtStart) {
              next.expiry = frontResult.extraction.expiry || next.expiry;
            }
          } else {
            const backResult = result as Awaited<ReturnType<typeof extractCardBack>>;
            if (entry.cvvManualVersion === cvvEditVersionAtStart) {
              next.cvv = backResult.extraction.cvv || next.cvv;
            }
          }
          return next;
        }));
        return draft.storagePath;
      } catch (error) {
        if (isCurrentSide(cardID, side, generation)) {
          const message = error instanceof Error ? error.message : "Extraction failed";
          setSideState(cardID, side, (entry) => ({ ...entry, status: "error", warnings: [message], isExtracting: false }));
          toast.error(message);
        }
        return draft.storagePath;
      }
    })();
    sidePromisesRef.current[key] = extractionPromise;
  };

  const extractPackageDetails = async (cardID: string) => {
    const card = cards.find((entry) => entry.id === cardID);
    if (!card || !hasDraftImage(card.packageImage)) return;
    const packageVersion = card.packageImage.id;
    const manualVersionAtStart = card.packageManualVersion;
    setCards((prev) => prev.map((entry) => (entry.id === cardID ? { ...entry, packageIsExtracting: true, packageWarnings: [] } : entry)));
    try {
      let storagePath = card.packageImage.storagePath;
      if (!storagePath && card.packageImage.file) {
        const result = await prepareAndUploadPrepaidImage(card.packageImage.file, "package", { grayscale: card.packageImage.imageGrayscale, upload: uploadPrepaidImage });
        storagePath = result.storagePath;
        if (storagePath) {
          setCards((prev) => prev.map((entry) => entry.id === cardID && entry.packageImage.id === packageVersion ? { ...entry, packageImage: { ...entry.packageImage, storagePath } } : entry));
        }
      }
      if (!storagePath) throw new Error("Package image is missing");
      const result = await extractPackage(storagePath);
      setCards((prev) => prev.map((entry) => {
        if (entry.id !== cardID || entry.packageImage.id !== packageVersion) return entry;
        const base = { ...entry, packageImage: { ...entry.packageImage, storagePath }, packageWarnings: result.warnings || [], packageIsExtracting: false };
        if (entry.packageManualVersion !== manualVersionAtStart) return base;
        return { ...base, activationBarcode: result.extraction.activation_barcode || entry.activationBarcode, vanillaSerial: result.extraction.serial_number || entry.vanillaSerial, denomination: result.extraction.denomination != null ? String(result.extraction.denomination) : entry.denomination };
      }));
    } catch (error) {
      if (cards.find((entry) => entry.id === cardID)?.packageImage.id !== packageVersion) return;
      const message = error instanceof Error ? error.message : "Package extraction failed";
      toast.error(message);
      setCards((prev) => prev.map((entry) => (entry.id === cardID ? { ...entry, packageIsExtracting: false, packageWarnings: [message] } : entry)));
    }
  };

  const removeActivation = (id: string) => {
    setActivationReceipts((prev) => {
      const target = prev.find((entry) => entry.id === id);
      if (target) revokeDraft(target);
      return prev.filter((entry) => entry.id !== id);
    });
    setCards((prev) => prev.map((card) => card.activationReceiptId === id ? { ...card, activationReceiptId: "" } : card));
  };

  const ensureUploaded = async (draft: ImageDraft, imageType: PrepaidImageType) => {
    if (draft.storagePath) return draft.storagePath;
    if (!draft.file) return undefined;
    const result = await prepareAndUploadPrepaidImage(draft.file, imageType, { grayscale: draft.imageGrayscale, upload: uploadPrepaidImage });
    return result.storagePath;
  };

  const closeAndCleanup = () => {
    if (salesPreview) URL.revokeObjectURL(salesPreview);
    activationReceipts.forEach(revokeDraft);
    cards.forEach(revokeCardDraft);
    onClose();
  };

  const savePurchase = async () => {
    setIsSaving(true);
    setSubmitError(null);
    try {
      const savedSalesReceiptID = await ensureSalesReceipt();
      const uploadedActivations: Array<{ id: string; storage_path: string; filename?: string; content_type?: string }> = [];
      for (const item of activationReceipts) {
        if (!hasDraftImage(item)) continue;
        const storagePath = await ensureUploaded(item, "activation_receipt");
        if (storagePath) {
          setActivationReceipts((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, storagePath } : entry));
          uploadedActivations.push({ id: item.id, storage_path: storagePath, filename: item.filename || item.file?.name || "activation-receipt.webp", content_type: "image/webp" });
        }
      }

      const cardPayload: PrepaidCardInput[] = [];
      for (const card of cards) {
        if (!hasCardContent(card)) continue;
        let packagePath = card.packageImage.storagePath;
        if (!packagePath && card.packageImage.file) {
          packagePath = await ensureUploaded(card.packageImage, "package");
          if (packagePath) setCards((prev) => prev.map((entry) => entry.id === card.id ? { ...entry, packageImage: { ...entry.packageImage, storagePath: packagePath } } : entry));
        }
        const sidePaths: Partial<Record<CardSide, string | undefined>> = {};
        for (const side of ["front", "back"] as const) {
          const key = `${card.id}:${side}`;
          sidePaths[side] = sidePromisesRef.current[key]
            ? await sidePromisesRef.current[key]
            : card[side].storagePath || await ensureUploaded(card[side], side === "front" ? "card_front" : "card_back");
        }
        cardPayload.push({
          activation_barcode: digitsOnly(card.activationBarcode),
          vanilla_serial: digitsOnly(card.vanillaSerial),
          denomination: moneyOrUndefined(card.denomination),
          activation_receipt_id: card.activationReceiptId || undefined,
          package_image_storage_path: packagePath,
          card_front_image_storage_path: sidePaths.front,
          card_back_image_storage_path: sidePaths.back,
          pan: digitsOnly(card.pan) || undefined,
          expiry: card.expiry.trim() || undefined,
          cvv: digitsOnly(card.cvv) || undefined,
          confirmed: true,
        });
      }

      await createPurchase({ sales_receipt_id: savedSalesReceiptID, activation_receipts: uploadedActivations, cards: cardPayload });
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
      <header className="flex items-center justify-between border-b px-4 py-3"><button onClick={closeAndCleanup} className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors"><X className="w-5 h-5" /></button><div className="text-center"><h2 className="text-sm font-semibold">Add Purchase</h2><p className="text-xs text-muted-foreground">{steps[step]}</p></div><Button size="sm" onClick={step === 3 ? savePurchase : continueFlow} disabled={!canContinue || isSaving || salesReceiptUploading}>{isSaving || salesReceiptUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : step === 3 ? "Save" : "Next"}</Button></header>
      <div className="border-b px-4 py-3"><div className="max-w-2xl mx-auto grid grid-cols-4 gap-2">{steps.map((label, index) => <button key={label} onClick={() => setStep(index as Step)} className={cn("h-1.5 rounded-full transition-colors", index <= step ? "bg-primary" : "bg-muted")} aria-label={label} />)}</div></div>
      <main className="flex-1 overflow-y-auto"><div className="max-w-2xl mx-auto p-4 space-y-4">
        {submitError && <Alert variant="destructive"><AlertDescription>{submitError}</AlertDescription></Alert>}
        {step === 0 && <section className="space-y-4"><input ref={salesFileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) setSalesImage(file); event.target.value = ""; }} />{salesPreview ? <ImagePreview preview={salesPreview} onClear={() => { if (salesReceiptID) return; setSalesFile(null); setSalesPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; }); }} locked={!!salesReceiptID} /> : <CaptureChoices onCamera={() => setSalesCameraOpen(true)} onGallery={() => salesFileRef.current?.click()} />}{salesReceiptID && <Alert><AlertDescription>Sales receipt saved in Receipt Keeper. Retries will reuse this receipt.</AlertDescription></Alert>}<div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">The sales receipt is uploaded through normal Receipt Keeper and will appear in your regular receipt list.</div></section>}
        {step === 1 && <section className="space-y-3"><div className="rounded-lg border bg-card p-4"><p className="text-sm font-medium">Activation receipts <span className="text-muted-foreground">(optional)</span></p><p className="mt-1 text-xs text-muted-foreground">Add one or more activation receipt images if available, or continue without them. Each activation receipt can be linked to at most one card.</p></div>{activationReceipts.map((item, index) => <ImageSlot key={item.id} title={`Activation receipt ${index + 1}`} draft={item} onFile={(file, colorMode) => updateActivationFile(item.id, file, colorMode)} onClear={() => clearActivationFile(item.id)} onRemove={() => removeActivation(item.id)} />)}<Button variant="outline" className="w-full" onClick={() => setActivationReceipts((prev) => [...prev, newImageDraft()])}><Plus className="w-4 h-4 mr-2" />{activationReceipts.length > 0 ? "Add another activation receipt" : "Add activation receipt"}</Button></section>}
        {step === 2 && <section className="space-y-4">{cards.map((card, index) => <CardCapture key={card.id} index={index} card={card} activationReceipts={activationReceipts} blockedActivationReceiptIDs={new Set(cards.filter((entry) => entry.id !== card.id).map((entry) => entry.activationReceiptId).filter(Boolean))} onPackageFile={(file, colorMode) => updatePackageFile(card.id, file, colorMode)} onClearPackage={() => clearPackage(card.id)} onSideFile={(side, file, colorMode) => updateCardSideFile(card.id, side, file, colorMode)} onClearSide={(side) => { setSideState(card.id, side, (draft) => { revokeDraft(draft); return newSideDraft(); }); sideGenerationsRef.current[`${card.id}:${side}`] = (sideGenerationsRef.current[`${card.id}:${side}`] ?? 0) + 1; }} onChange={(updates) => setCards((prev) => prev.map((entry) => { if (entry.id !== card.id) return entry; return { ...entry, ...updates, packageManualVersion: entry.packageManualVersion + (["activationBarcode", "vanillaSerial", "denomination"].some((field) => field in updates) ? 1 : 0), panManualVersion: entry.panManualVersion + ("pan" in updates ? 1 : 0), expiryManualVersion: entry.expiryManualVersion + ("expiry" in updates ? 1 : 0), cvvManualVersion: entry.cvvManualVersion + ("cvv" in updates ? 1 : 0) }; }))} onExtractPackage={() => void extractPackageDetails(card.id)} onRetrySide={(side) => retryCardSide(card.id, side)} onRemove={() => { setCards((prev) => { const target = prev.find((entry) => entry.id === card.id); if (target) revokeCardDraft(target); const next = prev.filter((entry) => entry.id !== card.id); return next.length > 0 ? next : [newCardDraft()]; }); }} />)}<Button variant="outline" className="w-full" onClick={() => setCards((prev) => [...prev, newCardDraft()])}><Plus className="w-4 h-4 mr-2" />Add another card</Button></section>}
        {step === 3 && <section className="space-y-3"><ReviewRow icon={<ReceiptText className="w-4 h-4" />} label="Sales receipt" value={salesReceiptID ? "Saved in Receipt Keeper" : salesFile?.name || "Missing"} /><ReviewRow icon={<ScanLine className="w-4 h-4" />} label="Activation receipts" value={String(activationReceipts.filter(hasDraftImage).length)} />{cards.filter(hasCardContent).map((card, index) => <div key={card.id} className="rounded-lg border bg-card p-4 space-y-1"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Card {index + 1}</span><span className="text-sm tabular-nums">${moneyOrUndefined(card.denomination)?.toFixed(2) || "0.00"}</span></div><p className="text-xs text-muted-foreground break-all">Package barcode: {digitsOnly(card.activationBarcode)}</p><p className="text-xs text-muted-foreground">Vanilla serial: {digitsOnly(card.vanillaSerial)}</p><p className="text-xs text-muted-foreground">Activation receipt: {card.activationReceiptId ? "Linked" : "Not linked"}</p><p className="text-xs text-muted-foreground">Card front: {hasDraftImage(card.front) ? "Added" : "Not added"} · Card back: {hasDraftImage(card.back) ? "Added" : "Not added"}</p></div>)}</section>}
      </div></main>
      <footer className="border-t px-4 py-3"><div className="max-w-2xl mx-auto flex items-center justify-between gap-3"><Button variant="outline" onClick={() => setStep(Math.max(0, step - 1) as Step)} disabled={step === 0 || isSaving}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button><Button onClick={step === 3 ? savePurchase : continueFlow} disabled={!canContinue || isSaving || salesReceiptUploading}>{isSaving || salesReceiptUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : step === 3 ? <Check className="w-4 h-4 mr-2" /> : null}{step === 3 ? "Save purchase" : "Continue"}</Button></div></footer>
      <BrowserCamera open={salesCameraOpen} onCapture={setSalesImage} defaultColorMode="grayscale" onClose={() => setSalesCameraOpen(false)} />
    </div>
  );
}

function CaptureChoices({ onCamera, onGallery, cameraLabel = "Camera", galleryLabel = "Gallery" }: { onCamera: () => void; onGallery: () => void; cameraLabel?: string; galleryLabel?: string }) {
  return <div className="grid grid-cols-2 gap-3"><button onClick={onCamera} className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-10 hover:bg-secondary/50"><Camera className="w-6 h-6 text-muted-foreground" /><span className="text-sm font-medium text-muted-foreground">{cameraLabel}</span></button><button onClick={onGallery} className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-10 hover:bg-secondary/50"><Upload className="w-6 h-6 text-muted-foreground" /><span className="text-sm font-medium text-muted-foreground">{galleryLabel}</span></button></div>;
}

function ImagePreview({ preview, onClear, locked = false }: { preview: string; onClear: () => void; locked?: boolean }) {
  return <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted ring-1 ring-border"><img src={preview} alt="" className="h-full w-full object-cover" />{!locked && <button onClick={onClear} className="absolute right-2 top-2 rounded-md bg-card/90 p-1.5"><X className="w-4 h-4" /></button>}</div>;
}

function ImageSlot({ title, draft, onFile, onClear, onRemove, cameraLabel = "Camera", galleryLabel = "Gallery", status }: { title: string; draft: ImageDraft; onFile: (file: File, colorMode?: CameraColorMode) => void; onClear: () => void; onRemove?: () => void; cameraLabel?: string; galleryLabel?: string; status?: ReactNode }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return <div className="rounded-lg border bg-card p-3 space-y-3"><div className="flex items-center justify-between"><span className="text-sm font-medium">{title}</span>{onRemove && <button aria-label={`Remove ${title}`} onClick={onRemove} className="p-1 rounded-md hover:bg-secondary"><X className="w-4 h-4" /></button>}</div><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ""; }} />{draft.preview ? <ImagePreview preview={draft.preview} onClear={onClear} /> : <CaptureChoices onCamera={() => setCameraOpen(true)} onGallery={() => fileRef.current?.click()} cameraLabel={cameraLabel} galleryLabel={galleryLabel} />}{status}<BrowserCamera open={cameraOpen} defaultColorMode="color" onCapture={onFile} onClose={() => setCameraOpen(false)} /></div>;
}

function CardCapture({ index, card, activationReceipts, blockedActivationReceiptIDs, onPackageFile, onClearPackage, onSideFile, onClearSide, onChange, onExtractPackage, onRetrySide, onRemove }: { index: number; card: CardDraft; activationReceipts: ImageDraft[]; blockedActivationReceiptIDs: ReadonlySet<string>; onPackageFile: (file: File, colorMode?: CameraColorMode) => void; onClearPackage: () => void; onSideFile: (side: CardSide, file: File, colorMode?: CameraColorMode) => void; onClearSide: (side: CardSide) => void; onChange: (updates: Partial<CardDraft>) => void; onExtractPackage: () => void; onRetrySide: (side: CardSide) => void; onRemove: () => void }) {
  const sideStatus = (side: CardSide) => {
    const draft = card[side];
    if (draft.status === "preparing" || draft.status === "extracting") return <p className="text-xs text-muted-foreground">Extracting {side} details…</p>;
    if (draft.status === "ready") return <p className="text-xs text-muted-foreground">{side === "front" ? "PAN and expiry extracted" : "CVV extracted"}</p>;
    if (draft.warnings.length > 0) return <div className="space-y-2"><Alert><AlertDescription>{draft.warnings.join(". ")}</AlertDescription></Alert><Button type="button" variant="outline" size="sm" onClick={() => onRetrySide(side)} disabled={!draft.storagePath && !draft.file}>Retry {side} extraction</Button></div>;
    return null;
  };
  const activationOptions = activationReceipts.filter((receipt) => hasDraftImage(receipt) && !blockedActivationReceiptIDs.has(receipt.id)).map((receipt) => ({
    receipt,
    index: activationReceipts.findIndex((entry) => entry.id === receipt.id),
  }));
  return <div className="rounded-lg border bg-card p-3 space-y-3"><div className="flex items-center justify-between"><span className="text-sm font-medium">Card/package {index + 1}</span><button onClick={onRemove} className="p-1 rounded-md hover:bg-secondary"><X className="w-4 h-4" /></button></div><ImageSlot title="Package image" draft={card.packageImage} onFile={onPackageFile} onClear={onClearPackage} /><Button type="button" variant="outline" className="w-full" onClick={onExtractPackage} disabled={card.packageIsExtracting || !hasDraftImage(card.packageImage)}>{card.packageIsExtracting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanLine className="w-4 h-4 mr-2" />}Extract package details</Button>{card.packageWarnings.length > 0 && <Alert><AlertDescription>{card.packageWarnings.join(". ")}</AlertDescription></Alert>}<div className="space-y-2"><Input inputMode="numeric" value={card.activationBarcode} maxLength={30} onChange={(event) => onChange({ activationBarcode: digitsOnly(event.target.value).slice(0, 30) })} placeholder="30-digit package barcode" /><Input inputMode="numeric" value={card.vanillaSerial} maxLength={11} onChange={(event) => onChange({ vanillaSerial: digitsOnly(event.target.value).slice(0, 11) })} placeholder="11-digit Vanilla serial" /><Input inputMode="decimal" value={card.denomination} onChange={(event) => onChange({ denomination: event.target.value })} placeholder="Denomination" /></div><label className="block space-y-1 text-sm"><span className="text-sm font-medium">Activation receipt <span className="text-muted-foreground">(optional)</span></span><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-label={`Activation receipt for card ${index + 1}`} value={card.activationReceiptId} onChange={(event) => onChange({ activationReceiptId: event.target.value })}><option value="">No linked activation receipt</option>{activationOptions.map(({ receipt, index: receiptIndex }) => <option key={receipt.id} value={receipt.id}>Activation receipt {receiptIndex + 1}</option>)}</select></label><ImageSlot title="Card front" draft={card.front} onFile={(file, colorMode) => onSideFile("front", file, colorMode)} onClear={() => onClearSide("front")} cameraLabel="Front camera" galleryLabel="Front gallery" status={sideStatus("front")} /><ImageSlot title="Card back" draft={card.back} onFile={(file, colorMode) => onSideFile("back", file, colorMode)} onClear={() => onClearSide("back")} cameraLabel="Back camera" galleryLabel="Back gallery" status={sideStatus("back")} /><div className="space-y-2"><Input inputMode="numeric" value={card.pan} maxLength={16} onChange={(event) => onChange({ pan: digitsOnly(event.target.value).slice(0, 16) })} placeholder="16-digit PAN" /><Input value={card.expiry} onChange={(event) => onChange({ expiry: event.target.value })} placeholder="Expiry MM/YY" /><Input inputMode="numeric" value={card.cvv} maxLength={4} onChange={(event) => onChange({ cvv: digitsOnly(event.target.value).slice(0, 4) })} placeholder="CVV" /></div>{card.activationBarcode && <p className="text-xs text-muted-foreground break-all">Linked package barcode: {digitsOnly(card.activationBarcode)}</p>}</div>;
}

function ReviewRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex items-center gap-3 rounded-lg border bg-card p-4"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground truncate">{value}</p></div></div>;
}
