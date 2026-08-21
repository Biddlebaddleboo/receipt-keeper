import { useState, useEffect, useCallback } from "react";
import type { Receipt, ReceiptItem, ReplaceReceiptImageResponse } from "@/hooks/useReceiptApi";
import { X, Trash2, RotateCcw, Store, Calendar, DollarSign, CheckCircle2, AlertCircle, Loader2, FileText, Clock, List, ShoppingCart, Pencil, Check, Plus, Minus, Tag, Receipt as ReceiptIcon, Download, Crop, Camera, Upload } from "lucide-react";
import { toast } from "sonner";
import { useCategoryApi } from "@/hooks/useCategoryApi";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";
import { formatReceiptPurchaseDate, normalizeReceiptPurchaseDate } from "@/lib/receiptDate";
import { fetchSignedReceiptImageUrl } from "@/lib/receiptImage";
import { convertImageBlobToJpeg } from "@/lib/nativeImageConverter";
import { autoCropReceiptImage } from "@/lib/receiptAutoCrop";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";
import { FieldPath, doc, updateDoc } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";
import { BrowserCamera } from "@/components/BrowserCamera";

interface ReceiptDetailProps {
  receipt: Receipt;
  onClose: () => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  fetchReceipt: (id: string) => Promise<Receipt | null>;
  uploadReceiptImage: (file: File) => Promise<string>;
  replaceReceiptImage: (receiptID: string, storagePath: string) => Promise<ReplaceReceiptImageResponse>;
}

const statusConfig = {
  pending: { label: "Pending", color: "bg-muted text-muted-foreground", icon: null },
  uploading: { label: "Uploading…", color: "bg-primary/10 text-primary", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  success: { label: "Uploaded", color: "bg-success/10 text-success", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  error: { label: "Failed", color: "bg-destructive/10 text-destructive", icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

interface EditingItem {
  index: number;
  name: string;
  quantity: string;
  price: string;
}

export function ReceiptDetail({ receipt: initialReceipt, onClose, onRemove, onRetry, fetchReceipt, uploadReceiptImage, replaceReceiptImage }: ReceiptDetailProps) {
  const [receipt, setReceipt] = useState(initialReceipt);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [localDownloadPending, setLocalDownloadPending] = useState(false);
  const [imageEditPending, setImageEditPending] = useState<"crop" | "replace" | null>(null);
  const [cropPreviewFile, setCropPreviewFile] = useState<File | null>(null);
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [signedImageUrl, setSignedImageUrl] = useState<string | null>(null);
  const { categories } = useCategoryApi();
  const mirroredMetadataFields = useCallback(
    (updates: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(updates).filter(([key]) =>
          ["vendor", "subtotal", "tax", "total", "category", "purchase_date"].includes(key)
        )
      ),
    []
  );

  const updateReceiptInFirestore = useCallback(async (updates: Record<string, unknown>) => {
    if (!receipt.shard_doc_id) {
      throw new Error("Receipt is missing shard_doc_id");
    }

    const detailRef = doc(db, "receipts", receipt.shard_doc_id, "details", receipt.id);
    await updateDoc(detailRef, updates);

    const summaryUpdates = mirroredMetadataFields(updates);
    if (Object.keys(summaryUpdates).length === 0) {
      return;
    }

    const shardRef = doc(db, "receipts", receipt.shard_doc_id);
    await Promise.all(
      Object.entries(summaryUpdates).map(([key, value]) =>
        updateDoc(shardRef, new FieldPath("receipt_metadata", receipt.id, key), value)
      )
    );
  }, [mirroredMetadataFields, receipt.id, receipt.shard_doc_id]);

  const fetchSignedImageUrl = useCallback(fetchSignedReceiptImageUrl, []);

  const fetchCurrentImageBlob = useCallback(async () => {
    const imageEndpoint = receipt.localImageUrl || signedImageUrl || (await fetchSignedImageUrl(receipt.id));
    if (!imageEndpoint) throw new Error("Signed URL not available");
    const response = await fetch(imageEndpoint, { credentials: "omit" });
    if (!response.ok) throw new Error(`Image download failed (${response.status})`);
    return response.blob();
  }, [fetchSignedImageUrl, receipt.id, receipt.localImageUrl, signedImageUrl]);

  const refreshReceiptImage = useCallback(async () => {
    const freshReceipt = await fetchReceipt(receipt.id);
    if (freshReceipt) setReceipt(freshReceipt);
    const freshUrl = await fetchSignedImageUrl(receipt.id);
    setSignedImageUrl(freshUrl);
  }, [fetchReceipt, fetchSignedImageUrl, receipt.id]);

  const clearCropPreview = useCallback(() => {
    setCropPreviewFile(null);
    setCropPreviewUrl(null);
  }, []);

  useEffect(() => {
    return () => {
      if (cropPreviewUrl) URL.revokeObjectURL(cropPreviewUrl);
    };
  }, [cropPreviewUrl]);

  const saveReplacementImage = useCallback(async (sourceFile: File, successMessage: string, shouldCrop = true) => {
    const croppedFile = shouldCrop ? await autoCropReceiptImage(sourceFile) : sourceFile;
    const webpFile = await convertReceiptImageFile(croppedFile);
    if (webpFile.type !== "image/webp") throw new Error("Image conversion to WebP failed");
    const storagePath = await uploadReceiptImage(webpFile);
    const replacement = await replaceReceiptImage(receipt.id, storagePath);
    await refreshReceiptImage();
    const oldImageDeleteError = replacement.old_image_delete_error?.trim();
    if (oldImageDeleteError) {
      toast.warning(`New image saved successfully, but the previous GCS image could not be deleted: ${oldImageDeleteError}`);
    } else {
      toast.success(successMessage);
    }
  }, [receipt.id, refreshReceiptImage, replaceReceiptImage, uploadReceiptImage]);

  const cropExistingImage = async () => {
    if (imageEditPending) return;
    setImageEditPending("crop");
    try {
      const sourceBlob = await fetchCurrentImageBlob();
      const sourceFile = new File([sourceBlob], `receipt-${receipt.id}.webp`, { type: sourceBlob.type || "image/webp" });
      const croppedFile = await autoCropReceiptImage(sourceFile);
      if (croppedFile === sourceFile) {
        toast.success("Image is already sufficiently cropped");
        return;
      }
      setCropPreviewFile(croppedFile);
      setCropPreviewUrl(URL.createObjectURL(croppedFile));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to crop receipt image");
    } finally {
      setImageEditPending(null);
    }
  };

  const applyCropPreview = async () => {
    if (!cropPreviewFile || imageEditPending) return;
    const croppedFile = cropPreviewFile;
    setImageEditPending("crop");
    try {
      await saveReplacementImage(croppedFile, "Receipt image cropped", false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply receipt crop");
    } finally {
      clearCropPreview();
      setImageEditPending(null);
    }
  };

  const replaceExistingImage = async (sourceFile: File) => {
    if (imageEditPending) return;
    if (!sourceFile.type.startsWith("image/")) {
      toast.error("Only image files are allowed");
      return;
    }
    setImageEditPending("replace");
    try {
      await saveReplacementImage(sourceFile, "Receipt image replaced");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to replace receipt image");
    } finally {
      setImageEditPending(null);
    }
  };

  const saveField = async (field: string, value: string) => {
    const payload: Record<string, unknown> = {};
    if (field === "vendor") payload.vendor = value.trim();
    else if (field === "total") payload.total = parseFloat(value);
    else if (field === "subtotal") payload.subtotal = parseFloat(value);
    else if (field === "tax") payload.tax = parseFloat(value);
    else if (field === "category") payload.category = value;
    else if (field === "purchase_date") {
      const trimmedDate = value.trim();
      const normalizedDate = trimmedDate ? normalizeReceiptPurchaseDate(trimmedDate) : "";
      if (normalizedDate === null) {
        toast.error("Invalid purchase date");
        return;
      }
      payload.purchase_date = normalizedDate;
    }

    if ((field === "total" || field === "subtotal" || field === "tax") && isNaN(payload[field] as number)) {
      toast.error(`Invalid ${field}`);
      return;
    }

    setIsSaving(true);
    try {
      await updateReceiptInFirestore(payload);
      setReceipt((prev) => ({ ...prev, ...payload }));
      if (field === "category") {
        window.dispatchEvent(
          new CustomEvent("receipt-category-updated", {
            detail: {
              receiptId: receipt.id,
              category: value,
            },
          })
        );
      }
      setEditingField(null);
      toast.success(`${field.charAt(0).toUpperCase() + field.slice(1).replace("_", " ")} updated`);
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const startFieldEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  };

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/receipts/${receipt.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete");
      onRemove(receipt.id);
      onClose();
    } catch {
      setIsDeleting(false);
    }
  }, [receipt.id, onRemove, onClose]);

  useEffect(() => {
    setReceipt(initialReceipt);
  }, [initialReceipt]);

  useEffect(() => {
    let cancelled = false;
    if (!initialReceipt?.id || initialReceipt.status !== "success") return;
    void fetchReceipt(initialReceipt.id).then((fresh) => {
      if (!cancelled && fresh) setReceipt(fresh);
    });
    return () => {
      cancelled = true;
    };
  }, [initialReceipt?.id, initialReceipt?.status, fetchReceipt]);

  useEffect(() => {
    let cancelled = false;

    const loadSignedImage = async () => {
      if (receipt.localImageUrl) {
        if (!cancelled) setSignedImageUrl(null);
        return;
      }
      if (!receipt.id) {
        if (!cancelled) setSignedImageUrl(null);
        return;
      }
      const url = await fetchSignedImageUrl(receipt.id);
      if (!cancelled) setSignedImageUrl(url);
    };

    void loadSignedImage();
    return () => {
      cancelled = true;
    };
  }, [receipt.id, receipt.localImageUrl, fetchSignedImageUrl]);

  const startEditing = (index: number) => {
    const item = receipt.items[index];
    setEditingItem({
      index,
      name: item.name,
      quantity: String(item.quantity),
      price: String(item.price),
    });
  };

  const cancelEditing = () => setEditingItem(null);

  const saveItem = async () => {
    if (!editingItem) return;
    const quantity = parseFloat(editingItem.quantity);
    const price = parseFloat(editingItem.price);
    if (!editingItem.name.trim() || isNaN(quantity) || isNaN(price)) {
      toast.error("Please fill in all fields with valid values");
      return;
    }

    const updatedItems = receipt.items.map((item, i) =>
      i === editingItem.index ? { name: editingItem.name.trim(), quantity, price } : item
    );

    setIsSaving(true);
    try {
      await updateReceiptInFirestore({ items: updatedItems });
      setReceipt((prev) => ({ ...prev, items: updatedItems }));
      setEditingItem(null);
      toast.success("Item updated");
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteItem = async (index: number) => {
    const updatedItems = receipt.items.filter((_, i) => i !== index);
    setIsSaving(true);
    try {
      await updateReceiptInFirestore({ items: updatedItems });
      setReceipt((prev) => ({ ...prev, items: updatedItems }));
      if (editingItem?.index === index) setEditingItem(null);
      toast.success("Item removed");
    } catch {
      toast.error("Failed to remove item");
    } finally {
      setIsSaving(false);
    }
  };

  const addItem = async () => {
    const newItem: ReceiptItem = { name: "New item", quantity: 1, price: 0 };
    const updatedItems = [...(receipt.items || []), newItem];
    setIsSaving(true);
    try {
      await updateReceiptInFirestore({ items: updatedItems });
      setReceipt((prev) => ({ ...prev, items: updatedItems }));
      startEditing(updatedItems.length - 1);
    } catch {
      toast.error("Failed to add item");
    } finally {
      setIsSaving(false);
    }
  };

  const status = statusConfig[receipt.status];
  const imageUrl = receipt.localImageUrl || signedImageUrl || null;
  const purchaseDate = receipt.purchase_date
    ? formatReceiptPurchaseDate(receipt.purchase_date, {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      })
    : "—";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <button onClick={onClose} className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">Receipt Details</h2>
        <div className="flex gap-1">
          {receipt.status === "error" && (
            <button onClick={() => onRetry(receipt.id)} className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95">
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
          <button
            aria-label="Download receipt"
            onClick={async () => {
              try {
                setLocalDownloadPending(true);
                const imageEndpoint = receipt.localImageUrl || signedImageUrl || (await fetchSignedImageUrl(receipt.id));
                if (!imageEndpoint) throw new Error("Signed URL not available");
                const res = await fetch(imageEndpoint, { credentials: "omit" });
                if (!res.ok) throw new Error("Download failed");
                const sourceBlob = await res.blob();
                const jpegBlob = await convertImageBlobToJpeg(sourceBlob);
                if (jpegBlob.type !== "image/jpeg") throw new Error("Image conversion to JPEG failed");
                const url = URL.createObjectURL(jpegBlob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `receipt-${receipt.vendor || receipt.id}.jpg`;
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                toast.error("Failed to download image");
              } finally {
                setLocalDownloadPending(false);
              }
            }}
            disabled={localDownloadPending}
            className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
          >
            {localDownloadPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors active:scale-95 disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {imageUrl && (
          <>
            <div className="aspect-[3/4] max-h-[50vh] bg-muted overflow-hidden">
              <img
                src={imageUrl}
                alt="Receipt"
                className="w-full h-full object-contain"
                onError={() => {
                  if (!receipt.localImageUrl) {
                    void fetchSignedImageUrl(receipt.id).then((freshUrl) => {
                      if (freshUrl) setSignedImageUrl(freshUrl);
                    });
                  }
                }}
              />
            </div>
            {receipt.status === "success" && (
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                <span className="basis-full text-xs font-semibold text-muted-foreground">Edit Receipt</span>
                <button
                  type="button"
                  onClick={() => void cropExistingImage()}
                  disabled={imageEditPending !== null || cropPreviewFile !== null}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {imageEditPending === "crop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crop className="h-3.5 w-3.5" />}
                  Crop Image
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  disabled={imageEditPending !== null || cropPreviewFile !== null}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Replace Image (Camera)
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-secondary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <Upload className="h-3.5 w-3.5" />
                  Replace Image (File)
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={imageEditPending !== null || cropPreviewFile !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void replaceExistingImage(file);
                    }}
                  />
                </label>
                {imageEditPending && <span className="text-xs text-muted-foreground">Processing image…</span>}
              </div>
            )}
          </>
        )}

        <div className="p-4 space-y-3">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}>
            {status.icon}
            {status.label}
          </div>

          <div className="space-y-2.5 pt-1">
            {/* Vendor */}
            {editingField === "vendor" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Vendor</label>
                <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("vendor", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("vendor", receipt.vendor || "")} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <Store className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Vendor</p>
                  <p className="text-sm font-medium">{receipt.vendor || "—"}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Subtotal */}
            {editingField === "subtotal" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Subtotal</label>
                <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} step="0.01" min="0" className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("subtotal", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("subtotal", String(receipt.subtotal ?? 0))} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <DollarSign className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Subtotal</p>
                  <p className="text-sm font-medium tabular-nums">${(receipt.subtotal ?? 0).toFixed(2)}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Tax */}
            {editingField === "tax" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Tax</label>
                <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} step="0.01" min="0" className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("tax", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("tax", String(receipt.tax ?? 0))} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <ReceiptIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Tax</p>
                  <p className="text-sm font-medium tabular-nums">${(receipt.tax ?? 0).toFixed(2)}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Total */}
            {editingField === "total" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Total</label>
                <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} step="0.01" min="0" className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("total", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("total", String(receipt.total))} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <DollarSign className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-sm font-medium tabular-nums">${receipt.total.toFixed(2)}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Category */}
            {editingField === "category" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Category</label>
                <select value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus>
                  <option value="">— None —</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("category", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("category", receipt.category || "")} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Category</p>
                  <p className="text-sm font-medium">{receipt.category || "—"}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Purchase Date */}
            {editingField === "purchase_date" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Purchase Date</label>
                <input type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("purchase_date", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("purchase_date", receipt.purchase_date || "")} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Purchase Date</p>
                  <p className="text-sm font-medium">{purchaseDate}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50">
              <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-sm font-medium">
                  {receipt.created_at
                    ? new Date(receipt.created_at).toLocaleString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                        hour: "numeric", minute: "2-digit",
                      })
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2 px-0.5">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Items</p>
              </div>
              <button
                onClick={addItem}
                disabled={isSaving}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-primary hover:bg-primary/10 transition-colors active:scale-95 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            <div className="space-y-1.5">
              {receipt.items && receipt.items.length > 0 ? (
                receipt.items.map((item, i) =>
                  editingItem?.index === i ? (
                    <div key={i} className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2.5 ring-1 ring-primary/20">
                      <input
                        type="text"
                        value={editingItem.name}
                        onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                        placeholder="Item name"
                        className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-muted-foreground mb-0.5 block">Qty</label>
                          <input
                            type="number"
                            value={editingItem.quantity}
                            onChange={(e) => setEditingItem({ ...editingItem, quantity: e.target.value })}
                            min="0"
                            step="1"
                            className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-muted-foreground mb-0.5 block">Price</label>
                          <input
                            type="number"
                            value={editingItem.price}
                            onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })}
                            min="0"
                            step="0.01"
                            className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-1.5 pt-0.5">
                        <button
                          onClick={cancelEditing}
                          className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveItem}
                          disabled={isSaving}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="group flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          ${item.price.toFixed(2)}
                        </span>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEditing(i)}
                            className="p-1 rounded hover:bg-background/60 transition-colors active:scale-95"
                          >
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => deleteItem(i)}
                            disabled={isSaving}
                            className="p-1 rounded hover:bg-destructive/10 transition-colors active:scale-95 disabled:opacity-50"
                          >
                            <Minus className="w-3.5 h-3.5 text-destructive" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                )
              ) : (
                <p className="text-xs text-muted-foreground px-1 py-2">No items yet</p>
              )}
            </div>
          </div>

          {receipt.extracted_fields && receipt.extracted_fields.length > 0 && (
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-2 px-0.5">
                <List className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extracted Fields</p>
              </div>
              <div className="space-y-1.5">
                {receipt.extracted_fields.map((field, i) => (
                  <div key={i} className="flex justify-between items-center px-3.5 py-2.5 rounded-lg bg-secondary/50">
                    <span className="text-xs text-muted-foreground">{field.label}</span>
                    <span className="text-sm font-medium tabular-nums">{field.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {receipt.extracted_text && (
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-2 px-0.5">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extracted Text</p>
              </div>
              <pre className="px-3.5 py-3 rounded-lg bg-secondary/50 text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                {receipt.extracted_text}
              </pre>
            </div>
          )}

          {receipt.errorMessage && (
            <p className="text-xs text-destructive px-1">{receipt.errorMessage}</p>
          )}
        </div>
      </div>

      <BrowserCamera
        open={cameraOpen}
        onCapture={(file) => void replaceExistingImage(file)}
        onClose={() => setCameraOpen(false)}
      />

      {cropPreviewFile && cropPreviewUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/95 p-4">
          <div className="flex max-h-full w-full max-w-xl flex-col gap-4 rounded-xl border bg-card p-4 shadow-xl">
            <div>
              <h3 className="text-base font-semibold">Preview Cropped Image</h3>
              <p className="mt-1 text-xs text-muted-foreground">Review the crop before replacing the stored receipt image.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-muted">
              <img src={cropPreviewUrl} alt="Cropped receipt preview" className="max-h-[65vh] w-full object-contain" />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={clearCropPreview}
                disabled={imageEditPending !== null}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void applyCropPreview()}
                disabled={imageEditPending !== null}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {imageEditPending === "crop" && <Loader2 className="h-4 w-4 animate-spin" />}
                Apply Crop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
