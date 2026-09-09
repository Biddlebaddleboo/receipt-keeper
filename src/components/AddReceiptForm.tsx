import { useEffect, useRef, useState } from "react";
import { X, Camera, Upload, Loader2, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";
import { autoCropReceiptImage } from "@/lib/receiptAutoCrop";
import { BrowserCamera, type CameraColorMode } from "@/components/BrowserCamera";
import { convertImageFileToGrayscale } from "@/lib/nativeImageConverter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  extractReceiptFieldsFromImage,
  RECEIPT_FRONTEND_FIELDS,
  type ReceiptFrontendDecision,
  type ReceiptFrontendExtraction,
  type ReceiptFrontendField,
} from "@/lib/receiptFrontendExtractor";

interface AddReceiptFormProps {
  onSubmit: (file: File, onProgress?: (progress: number) => void, imageGrayscale?: boolean, decision?: ReceiptFrontendDecision) => Promise<void> | void;
  onClose: () => void;
  disabled?: boolean;
}

export function AddReceiptForm({ onSubmit, onClose, disabled }: AddReceiptFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isQueueingUpload, setIsQueueingUpload] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [imageGrayscale, setImageGrayscale] = useState(false);
  const [extraction, setExtraction] = useState<ReceiptFrontendExtraction | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [fieldValues, setFieldValues] = useState<Partial<Record<ReceiptFrontendField, string>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setExtraction(null);
      setFieldValues({});
      setIsExtracting(false);
      return;
    }
    let cancelled = false;
    setIsExtracting(true);
    setOcrProgress(1);
    void extractReceiptFieldsFromImage(file, setOcrProgress)
      .then((next) => {
        if (cancelled) return;
        setExtraction(next);
        setFieldValues(Object.fromEntries(RECEIPT_FRONTEND_FIELDS.map((field) => [field, next.fields[field].value ?? ""])));
      })
      .finally(() => {
        if (!cancelled) setIsExtracting(false);
      });
    return () => { cancelled = true; };
  }, [file]);

  const handleFile = (f: File, colorMode: CameraColorMode = "color") => {
    if (!f.type.startsWith("image/")) {
      setSubmitError("Only image files are allowed.");
      return;
    }
    setSubmitError(null);
    setImageGrayscale(colorMode === "grayscale");
    setFile(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f, "color");
    e.target.value = "";
  };

  const handleClose = () => {
    setCameraOpen(false);
    onClose();
  };

  const buildDecision = (mode: ReceiptFrontendDecision["mode"]): ReceiptFrontendDecision => {
    const fields = extraction?.fields;
    const trusted: ReceiptFrontendDecision["fields"] = {};
    const unresolved: ReceiptFrontendField[] = [];
    RECEIPT_FRONTEND_FIELDS.forEach((field) => {
      const value = (fieldValues[field] ?? "").trim();
      if (!value) {
        unresolved.push(field);
        return;
      }
      const original = fields?.[field];
      const unchangedTrusted = original?.status === "trusted" && original.value === value;
      const manuallyReviewed = !original || original.value !== value || original.source === "manual";
      if (unchangedTrusted || manuallyReviewed) {
        trusted[field] = unchangedTrusted ? original : {
          value,
          confidence: 1,
          status: "trusted",
          source: "manual",
          evidence: "User reviewed or edited this value",
        };
      }
    });
    if (mode === "entire") return { mode, fields: {}, unresolvedFields: [...RECEIPT_FRONTEND_FIELDS], ocrText: extraction?.text ?? "" };
    return { mode: unresolved.length ? "remaining" : "none", fields: trusted, unresolvedFields: unresolved, ocrText: extraction?.text ?? "" };
  };

  const handleSubmit = async (mode?: ReceiptFrontendDecision["mode"]) => {
    if (!file) return;
    if (isQueueingUpload) return;

    setIsQueueingUpload(true);
    setUploadProgress(2);
    setSubmitError(null);
    let conversionProgressTimer: number | null = null;
    try {
      conversionProgressTimer = window.setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 14) return prev;
          return Math.min(14, prev + 1);
        });
      }, 220);

      const croppedFile = await autoCropReceiptImage(file);
      const grayscaleFile = imageGrayscale ? await convertImageFileToGrayscale(croppedFile) : croppedFile;
      const convertedFile = await convertReceiptImageFile(grayscaleFile);
      if (conversionProgressTimer) {
        window.clearInterval(conversionProgressTimer);
        conversionProgressTimer = null;
      }
      setUploadProgress((prev) => Math.max(prev, 15));
      if (convertedFile.type !== "image/webp") {
        throw new Error(`WebP conversion failed. Got type: ${convertedFile.type || "unknown"}`);
      }
      await onSubmit(convertedFile, (progress) => setUploadProgress(progress), imageGrayscale, buildDecision(mode ?? (extraction ? "remaining" : "entire")));
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setSubmitError(message);
      console.error(error);
      setUploadProgress(0);
    } finally {
      if (conversionProgressTimer) window.clearInterval(conversionProgressTimer);
      setIsQueueingUpload(false);
    }
  };

  const updateField = (field: ReceiptFrontendField, value: string) => {
    setFieldValues((current) => ({ ...current, [field]: value }));
    setExtraction((current) => current ? {
      ...current,
      fields: { ...current.fields, [field]: { ...current.fields[field], value: value || null, status: value ? "trusted" : "missing", confidence: value ? 1 : 0, source: "manual", evidence: "User edited this value" } },
      unresolvedFields: RECEIPT_FRONTEND_FIELDS.filter((candidate) => candidate === field ? !value : current.fields[candidate].status !== "trusted"),
    } : current);
  };

  const fieldLabels: Record<ReceiptFrontendField, string> = {
    vendor: "Store name",
    purchase_date: "Receipt date",
    subtotal: "Subtotal",
    tax: "Tax",
    total: "Total",
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleInputChange} />
      <BrowserCamera
        open={cameraOpen}
        defaultColorMode="grayscale"
        onCapture={handleFile}
        onClose={() => setCameraOpen(false)}
      />
      <header className="flex items-center justify-between px-4 py-3 border-b">
            <button onClick={handleClose} className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-semibold">New Receipt</h2>
            <button
              onClick={() => handleSubmit()}
              disabled={!file || disabled || isQueueingUpload || isExtracting}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95",
                file ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground pointer-events-none"
              )}
            >
              Continue
            </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {submitError && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {submitError}
          </div>
        )}

        {preview ? (
          <div className="space-y-3">
            <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-muted ring-1 ring-border">
              <img src={preview} alt="Receipt preview" className="w-full h-full object-cover" />
              <button
                onClick={() => { setFile(null); if (preview) URL.revokeObjectURL(preview); setPreview(null); setUploadProgress(0); }}
                disabled={isQueueingUpload}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-card/90 backdrop-blur-sm hover:bg-card transition-colors active:scale-95 disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {isQueueingUpload && (
              <div className="w-full h-2 rounded-full bg-secondary overflow-hidden ring-1 ring-border/60">
                <div
                  className="h-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(1, Math.min(100, uploadProgress))}%` }}
                />
              </div>
            )}
            {!isQueueingUpload && (
              <section aria-label="Receipt extraction review" className="rounded-lg border bg-card p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Review extracted fields</h3>
                    <p className="text-xs text-muted-foreground">Only high-confidence fields skip AI. Blank or uncertain fields stay unresolved.</p>
                  </div>
                  {isExtracting && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="OCR in progress" />}
                </div>
                {isExtracting ? (
                  <div className="text-xs text-muted-foreground">Reading receipt locally… {ocrProgress}%</div>
                ) : (
                  <div className="space-y-2">
                    {RECEIPT_FRONTEND_FIELDS.map((field) => {
                      const item = extraction?.fields[field];
                      const trusted = item?.status === "trusted" && item.value === fieldValues[field];
                      return (
                        <div key={field} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <label htmlFor={`receipt-${field}`} className="font-medium">{fieldLabels[field]}</label>
                            <span className={cn("flex items-center gap-1", trusted ? "text-emerald-600" : "text-amber-600")}>
                              {trusted ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                              {trusted ? `High confidence (${Math.round((item?.confidence ?? 1) * 100)}%)` : "Needs review / AI"}
                            </span>
                          </div>
                          <Input id={`receipt-${field}`} value={fieldValues[field] ?? ""} onChange={(event) => updateField(field, event.target.value)} placeholder="Not detected" disabled={isQueueingUpload} />
                          {item?.evidence && <p className="truncate text-[11px] text-muted-foreground">Evidence: {item.evidence}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Button onClick={() => handleSubmit()} disabled={isExtracting || isQueueingUpload} className="w-full">Continue</Button>
                  <Button onClick={() => handleSubmit("remaining")} disabled={isExtracting || isQueueingUpload} variant="secondary" className="w-full"><Sparkles />Use AI for remaining</Button>
                  <Button onClick={() => handleSubmit("entire")} disabled={isExtracting || isQueueingUpload} variant="outline" className="w-full"><Sparkles />Use AI for entire receipt</Button>
                </div>
                <Button onClick={handleClose} disabled={isQueueingUpload} variant="ghost" className="w-full">Reject</Button>
              </section>
            )}
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => setCameraOpen(true)}
              className="flex-1 flex flex-col items-center gap-2 py-10 rounded-lg border-2 border-dashed border-border hover:border-primary/40 hover:bg-secondary/50 transition-colors active:scale-[0.98]"
            >
              <Camera className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground font-medium">Camera</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-2 py-10 rounded-lg border-2 border-dashed border-border hover:border-primary/40 hover:bg-secondary/50 transition-colors active:scale-[0.98]"
            >
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground font-medium">Gallery</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
