import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";
import { formatReceiptPurchaseDate } from "@/lib/receiptDate";

export interface ExtractedField {
  label: string;
  value: string;
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

interface ReceiptUploadMeta {
  vendor?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  category?: string;
  purchase_date?: string;
  invoice_id?: string;
  image_grayscale?: boolean;
}

interface SignedUploadResponse {
  storage_path: string;
  upload_url: string;
  form_fields?: Record<string, string> | null;
  fields?: Record<string, string> | null;
  expires_at: string;
}

export interface ReplaceReceiptImageResponse {
  receipt_id: string;
  storage_path: string;
  old_image_delete_error?: string;
}

type UploadProgressCallback = (progress: number) => void;

export interface Receipt {
  id: string;
  vendor: string;
  subtotal: number;
  tax: number;
  total: number;
  category: string;
  purchase_date: string;
  invoice_id?: string;
  extracted_text: string;
  extracted_fields: ExtractedField[];
  items: ReceiptItem[];
  created_at: string;
  image_url?: string;
  image_grayscale?: boolean;
  // Client-side fields
  file?: File;
  localImageUrl?: string;
  status: "pending" | "uploading" | "success" | "error";
  errorMessage?: string;
  shard_doc_id?: string;
}

interface UseReceiptApiOptions {
  pollingPaused?: boolean;
}

// Shard metadata mirrors the current user-editable value. Detail fields are
// only a fallback for older records that genuinely lack the mirrored value;
// historical AI suggestions must never replace either canonical source.
const canonicalEditableText = (metadataValue: unknown, detailValue: unknown): string => {
  if (typeof metadataValue === "string" && metadataValue.trim()) return metadataValue;
  if (typeof detailValue === "string" && detailValue.trim()) return detailValue;
  return "";
};

const canonicalNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const hasCanonicalNumber = (value: unknown): boolean => canonicalNumber(value) !== null;

const hasCompleteCanonicalMetadata = (metadata: Record<string, unknown>): boolean =>
  Boolean(
    canonicalEditableText(metadata.vendor, undefined) &&
    hasCanonicalNumber(metadata.subtotal) &&
    hasCanonicalNumber(metadata.tax) &&
    hasCanonicalNumber(metadata.total) &&
    canonicalEditableText(metadata.category, undefined) &&
    canonicalEditableText(metadata.purchase_date, undefined)
  );

const hasCompleteCanonicalSources = (
  metadata: Record<string, unknown>,
  detail?: Record<string, unknown>,
): boolean => {
  const detailData = detail ?? {};
  return Boolean(
    canonicalEditableText(metadata.vendor, detailData.vendor) &&
    (canonicalNumber(metadata.subtotal) ?? canonicalNumber(detailData.subtotal)) !== null &&
    (canonicalNumber(metadata.tax) ?? canonicalNumber(detailData.tax)) !== null &&
    (canonicalNumber(metadata.total) ?? canonicalNumber(detailData.total)) !== null &&
    canonicalEditableText(metadata.category, detailData.category) &&
    canonicalEditableText(metadata.purchase_date, detailData.purchase_date)
  );
};

export function useReceiptApi(options?: UseReceiptApiOptions) {
  const pollingPaused = options?.pollingPaused ?? false;
  const { token, user, isLoading: authLoading, firebaseUID, isFirebaseReady } = useAuth();
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const userEmailRef = useRef(user?.email ?? null);
  useEffect(() => {
    userEmailRef.current = user?.email ?? null;
  }, [user?.email]);

  const getSignedUpload = async (file: File): Promise<SignedUploadResponse> => {
    const contentType = file.type?.trim() || "image/jpeg";
    const response = await apiFetch(`${API_BASE_URL}/receipts/signed-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: file.name,
        content_type: contentType,
      }),
    });

    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<SignedUploadResponse>;
  };

  const uploadToGCSViaPolicy = async (
    uploadUrl: string,
    file: File,
    formFields: Record<string, string>,
    onProgress?: UploadProgressCallback
  ) => {
    const fd = new FormData();
    Object.entries(formFields).forEach(([key, value]) => fd.append(key, value));
    fd.append("file", file);

    console.debug("[upload] form data keys", Array.from(fd.keys()));
    onProgress?.(55);
    const response = await fetch(uploadUrl, { method: "POST", body: fd });
    const responseText = await response.text().catch(() => "");
    console.debug("[upload] gcs status", response.status);
    console.debug("[upload] gcs response text", responseText);

    if (response.status === 201 || response.status === 204) return;
    throw new Error(`GCS policy upload failed (${response.status}): ${responseText || "No response body"}`);
  };

  const finalizeUpload = async (storagePath: string, meta?: ReceiptUploadMeta) => {
    const response = await apiFetch(`${API_BASE_URL}/receipts/finalize-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        storage_path: storagePath,
        ...meta,
      }),
    });

    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };

  const uploadReceiptImage = async (file: File, onProgress?: UploadProgressCallback): Promise<string> => {
    if (file.type !== "image/webp") {
      throw new Error(`Only WebP uploads are allowed. Received: ${file.type || "unknown"}`);
    }

    onProgress?.(5);
    const signed = await getSignedUpload(file);
    console.debug("[upload] signed-upload response shape", {
      has_upload_url: typeof signed.upload_url === "string",
      has_storage_path: typeof signed.storage_path === "string",
      has_form_fields: signed.form_fields != null,
      has_fields: signed.fields != null,
      form_field_keys: signed.form_fields ? Object.keys(signed.form_fields) : [],
      fields_keys: signed.fields ? Object.keys(signed.fields) : [],
    });

    const resolvedFields = signed.form_fields ?? signed.fields;
    if (!resolvedFields || typeof resolvedFields !== "object") {
      throw new Error("signed-upload response missing multipart policy fields (expected form_fields or fields).");
    }
    if (typeof signed.upload_url !== "string" || !signed.upload_url) {
      throw new Error("signed-upload response missing upload_url.");
    }
    if (typeof signed.storage_path !== "string" || !signed.storage_path) {
      throw new Error("signed-upload response missing storage_path.");
    }

    onProgress?.(15);
    await uploadToGCSViaPolicy(signed.upload_url, file, resolvedFields, onProgress);
    return signed.storage_path;
  };

  const createReceiptViaSignedUpload = async (file: File, meta?: ReceiptUploadMeta, onProgress?: UploadProgressCallback) => {
    const storagePath = await uploadReceiptImage(file, onProgress);
    onProgress?.(96);
    const finalized = await finalizeUpload(storagePath, meta);
    onProgress?.(100);
    return finalized;
  };

  const replaceReceiptImage = async (receiptID: string, storagePath: string, imageGrayscale?: boolean): Promise<ReplaceReceiptImageResponse> => {
    const response = await apiFetch(`${API_BASE_URL}/receipts/${encodeURIComponent(receiptID)}/replace-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storage_path: storagePath, ...(imageGrayscale === undefined ? {} : { image_grayscale: imageGrayscale }) }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<ReplaceReceiptImageResponse>;
  };

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const postUploadRefreshTimerRef = useRef<number | null>(null);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const shardCatalogRef = useRef<Array<{ id: string; data: Record<string, unknown> }>>([]);
  const nextShardListIndexRef = useRef(0);
  const hasLoadedFirstShardRef = useRef(false);
  const wasPollingPausedRef = useRef(pollingPaused);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  const normalizeReceipt = useCallback((r: Receipt): Receipt => {
    return {
      ...r,
      status: "success" as const,
    };
  }, []);

  const toISOString = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
      try {
        const date = (value as { toDate: () => Date }).toDate();
        return date.toISOString();
      } catch {
        return "";
      }
    }
    return "";
  };

  const toItems = (value: unknown): ReceiptItem[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      const quantity = canonicalNumber(record.quantity) ?? 0;
      const price = canonicalNumber(record.price) ?? 0;
      return [{ name, quantity, price }];
    });
  };

  const toExtractedFields = (value: unknown): ExtractedField[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.label !== "string" || typeof record.value !== "string") return [];
      return [{ label: record.label, value: record.value }];
    });
  };

  const fromShardMetadataEntry = useCallback((shardDocId: string, receiptId: string, raw: Record<string, unknown>): Receipt => {
    return normalizeReceipt({
      id: receiptId,
      vendor: canonicalEditableText(raw.vendor, undefined),
      subtotal: canonicalNumber(raw.subtotal) ?? 0,
      tax: canonicalNumber(raw.tax) ?? 0,
      total: canonicalNumber(raw.total) ?? 0,
      category: canonicalEditableText(raw.category, undefined),
      purchase_date: canonicalEditableText(raw.purchase_date, undefined),
      invoice_id: canonicalEditableText(raw.invoice_id, undefined),
      extracted_text: typeof raw.extracted_text === "string" ? raw.extracted_text : "",
      extracted_fields: Array.isArray(raw.extracted_fields) ? (raw.extracted_fields as ExtractedField[]) : [],
      items: Array.isArray(raw.items) ? (raw.items as ReceiptItem[]) : [],
      created_at: toISOString(raw.created_at),
      image_url: typeof raw.image_url === "string" ? raw.image_url : undefined,
      image_grayscale: raw.image_grayscale === true,
      status: "success",
      shard_doc_id: shardDocId,
    });
  }, [normalizeReceipt]);

  const fromShardDetailDoc = useCallback((
    shardDocId: string,
    receiptId: string,
    metadata: Record<string, unknown>,
    detailData: Record<string, unknown>
  ): Receipt => {
    const items =
      toItems(detailData.items).length > 0
        ? toItems(detailData.items)
        : toItems(metadata.items).length > 0
          ? toItems(metadata.items)
          : [];
    const extractedFields =
      toExtractedFields(detailData.extracted_fields).length > 0
        ? toExtractedFields(detailData.extracted_fields)
        : toExtractedFields(metadata.extracted_fields);

    return normalizeReceipt({
      id: receiptId,
      vendor: canonicalEditableText(metadata.vendor, detailData.vendor),
      subtotal: canonicalNumber(metadata.subtotal) ?? canonicalNumber(detailData.subtotal) ?? 0,
      tax: canonicalNumber(metadata.tax) ?? canonicalNumber(detailData.tax) ?? 0,
      total: canonicalNumber(metadata.total) ?? canonicalNumber(detailData.total) ?? 0,
      category: canonicalEditableText(metadata.category, detailData.category),
      purchase_date: canonicalEditableText(metadata.purchase_date, detailData.purchase_date),
      invoice_id: canonicalEditableText(metadata.invoice_id, detailData.invoice_id),
      extracted_text:
        typeof detailData.extracted_text === "string"
          ? detailData.extracted_text
          : typeof metadata.extracted_text === "string"
            ? metadata.extracted_text
            : "",
      extracted_fields: extractedFields,
      items,
      created_at: toISOString(detailData.created_at || metadata.created_at),
      image_url:
        typeof detailData.image_url === "string"
          ? detailData.image_url
          : typeof metadata.image_url === "string"
            ? metadata.image_url
            : undefined,
      image_grayscale: detailData.image_grayscale === true || metadata.image_grayscale === true,
      status: "success",
      shard_doc_id: shardDocId,
    });
  }, [normalizeReceipt]);

  const expandReceiptDocs = useCallback((docs: Array<{ id: string; data: Record<string, unknown> }>): Receipt[] => {
    const expanded: Receipt[] = [];
    docs.forEach(({ id, data }) => {
      const schema = typeof data._schema === "string" ? data._schema : "";
      const receiptMetadata = data.receipt_metadata as { [key: string]: unknown } | undefined;
      if (schema === "receipt_shard" && receiptMetadata && typeof receiptMetadata === "object" && !Array.isArray(receiptMetadata)) {
        Object.entries(receiptMetadata).forEach(([receiptId, rawMeta]) => {
          if (!receiptId.trim() || !rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) return;
          expanded.push(fromShardMetadataEntry(id, receiptId, rawMeta as Record<string, unknown>));
        });
      }
    });

    expanded.sort((a, b) => {
      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return bt - at;
    });
    return expanded;
  }, [fromShardMetadataEntry]);

  const fetchOwnerReceiptDocs = useCallback(async (): Promise<Array<{ id: string; data: Record<string, unknown> }>> => {
    if (!userEmailRef.current) return [];
    const snapshot = await getDocs(
      query(
        collection(db, "receipts"),
        where("owner_email", "==", userEmailRef.current),
      )
    );
    return snapshot.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  }, []);

  // The visible list intentionally pages through shards. Exports need the
  // complete owner-owned metadata set, so they use this separate all-doc path.
  const fetchAllReceipts = useCallback(async (): Promise<Receipt[]> => {
    if (authLoading || !tokenRef.current || !userEmailRef.current || !isFirebaseReady || !firebaseUID) return [];
    const ownerDocs = await fetchOwnerReceiptDocs();
    const uniqueReceipts = new Map<string, { receipt: Receipt; canonicalComplete: boolean }>();

    for (const shardDoc of ownerDocs) {
      const schema = typeof shardDoc.data._schema === "string" ? shardDoc.data._schema : "";
      if (schema !== "receipt_shard") continue;
      const receiptMetadata = shardDoc.data.receipt_metadata as { [key: string]: unknown } | undefined;
      if (!receiptMetadata || typeof receiptMetadata !== "object" || Array.isArray(receiptMetadata)) continue;

      for (const [receiptId, rawMeta] of Object.entries(receiptMetadata)) {
        if (!receiptId.trim() || !rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) continue;
        const metadata = rawMeta as Record<string, unknown>;
        const existing = uniqueReceipts.get(receiptId);
        if (existing?.canonicalComplete) continue;

        let receipt = fromShardMetadataEntry(shardDoc.id, receiptId, metadata);
        let canonicalComplete = hasCompleteCanonicalMetadata(metadata);
        if (!canonicalComplete) {
          try {
            const detailSnapshot = await getDoc(doc(db, "receipts", shardDoc.id, "details", receiptId));
            if (detailSnapshot.exists()) {
              const detailData = detailSnapshot.data() as Record<string, unknown>;
              receipt = fromShardDetailDoc(shardDoc.id, receiptId, metadata, detailData);
              canonicalComplete = hasCompleteCanonicalSources(metadata, detailData);
            }
          } catch {
            // Preserve metadata-only values when an optional detail fallback is unavailable.
          }
        }

        if (!existing || !existing.canonicalComplete || canonicalComplete) {
          uniqueReceipts.set(receiptId, { receipt, canonicalComplete });
        }
      }
    }

    return Array.from(uniqueReceipts.values())
      .map(({ receipt }) => receipt)
      .sort((a, b) => {
        const at = a.created_at ? Date.parse(a.created_at) : 0;
        const bt = b.created_at ? Date.parse(b.created_at) : 0;
        return bt - at;
      });
  }, [authLoading, fetchOwnerReceiptDocs, firebaseUID, fromShardDetailDoc, fromShardMetadataEntry, isFirebaseReady]);

  const toShardCatalog = useCallback((ownerDocs: Array<{ id: string; data: Record<string, unknown> }>) => {
    return ownerDocs
      .filter((d) => (typeof d.data._schema === "string" ? d.data._schema : "") === "receipt_shard")
      .sort((a, b) => {
        const ai = typeof a.data.shard_index === "number" ? a.data.shard_index : Number(a.data.shard_index || 0);
        const bi = typeof b.data.shard_index === "number" ? b.data.shard_index : Number(b.data.shard_index || 0);
        return bi - ai;
      });
  }, []);

  const mergeIncomingReceipts = useCallback((prev: Receipt[], incoming: Receipt[]) => {
    const incomingIds = new Set(incoming.map((r) => r.id));
    const incomingMap = new Map(incoming.map((r) => [r.id, r]));

    const mergedIncoming = incoming.map((incomingReceipt) => {
      const existing = prev.find((p) => p.id === incomingReceipt.id);
      if (!existing) return incomingReceipt;
      return {
        ...existing,
        ...incomingReceipt,
        localImageUrl: existing.localImageUrl || incomingReceipt.localImageUrl,
        file: existing.file,
        status: "success" as const,
        errorMessage: undefined,
      };
    });

    const rest = prev.filter((r) => !incomingIds.has(r.id));
    return [...mergedIncoming, ...rest.filter((r) => !incomingMap.has(r.id))];
  }, []);

  const uploadReceipt = async (file: File, onProgress?: UploadProgressCallback, imageGrayscale = false) => {
    if (authLoading || !tokenRef.current) return;

    const id = crypto.randomUUID();
    const localImageUrl = URL.createObjectURL(file);

    const newReceipt: Receipt = {
      id,
      vendor: "",
      total: 0,
      subtotal: 0,
      tax: 0,
      category: "",
      purchase_date: "",
      invoice_id: "",
      extracted_text: "",
      extracted_fields: [],
      items: [],
      created_at: new Date().toISOString(),
      localImageUrl,
      file,
      ...(imageGrayscale ? { image_grayscale: true } : {}),
      status: "uploading",
    };

    setReceipts((prev) => [newReceipt, ...prev]);
    setIsUploading(true);

    try {
      const data = (await createReceiptViaSignedUpload(
        file,
        imageGrayscale ? { image_grayscale: true } : undefined,
        onProgress,
      )) as Record<string, unknown>;

      setReceipts((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                ...data,
                id: typeof data.id === "string" ? data.id : id,
                status: "success" as const,
              }
            : r
        )
      );

      // Refresh latest shard once immediately and once again after 10s
      // to pick up delayed OCR/processing updates.
      void refreshLatest();
      if (postUploadRefreshTimerRef.current) {
        window.clearTimeout(postUploadRefreshTimerRef.current);
      }
      postUploadRefreshTimerRef.current = window.setTimeout(() => {
        void refreshLatest();
      }, 10_000);
    } catch (error) {
      onProgress?.(0);
      const message = error instanceof Error ? error.message : "Upload failed";
      setReceipts((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "error" as const, errorMessage: message } : r))
      );
      throw (error instanceof Error ? error : new Error(message));
    } finally {
      setIsUploading(false);
    }
  };

  const removeReceipt = (id: string) => {
    setReceipts((prev) => {
      const receipt = prev.find((r) => r.id === id);
      if (receipt?.localImageUrl) URL.revokeObjectURL(receipt.localImageUrl);
      return prev.filter((r) => r.id !== id);
    });
  };

  const retryUpload = (id: string) => {
    const receipt = receipts.find((r) => r.id === id);
    if (receipt?.file) {
      removeReceipt(id);
      uploadReceipt(receipt.file);
    }
  };

  // Group receipts by date
  const receiptsByDate = receipts.reduce<Record<string, Receipt[]>>((acc, receipt) => {
    const key = receipt.purchase_date
      ? formatReceiptPurchaseDate(receipt.purchase_date, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "Unknown Date";
    if (!acc[key]) acc[key] = [];
    acc[key].push(receipt);
    return acc;
  }, {});

  const fetchReceipt = useCallback(async (id: string): Promise<Receipt | null> => {
    if (authLoading || !tokenRef.current || !userEmailRef.current || !isFirebaseReady || !firebaseUID) return null;

    try {
      const ownerDocs = await fetchOwnerReceiptDocs();
      for (const shardDoc of ownerDocs) {
        const schema = typeof shardDoc.data._schema === "string" ? shardDoc.data._schema : "";
        if (schema !== "receipt_shard") continue;
        const receiptMetadata = shardDoc.data.receipt_metadata as { [key: string]: unknown } | undefined;
        if (!receiptMetadata || typeof receiptMetadata !== "object" || Array.isArray(receiptMetadata)) continue;
        const rawMeta = receiptMetadata[id];
        if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) continue;

        const detailSnapshot = await getDoc(doc(db, "receipts", shardDoc.id, "details", id));
        if (detailSnapshot.exists()) {
          return fromShardDetailDoc(
            shardDoc.id,
            id,
            rawMeta as Record<string, unknown>,
            detailSnapshot.data() as Record<string, unknown>
          );
        }

        return fromShardMetadataEntry(shardDoc.id, id, rawMeta as Record<string, unknown>);
      }

      return null;
    } catch {
      return null;
    }
  }, [authLoading, fetchOwnerReceiptDocs, fromShardDetailDoc, fromShardMetadataEntry, isFirebaseReady, firebaseUID]);

  const loadNextPage = useCallback(async () => {
    if (authLoading || isLoadingMoreRef.current || !tokenRef.current || !userEmailRef.current || !isFirebaseReady || !firebaseUID) return;
    if (hasLoadedFirstShardRef.current && !hasMore) return;

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      if (shardCatalogRef.current.length === 0) {
        const ownerDocs = await fetchOwnerReceiptDocs();
        shardCatalogRef.current = toShardCatalog(ownerDocs);
      }

      if (shardCatalogRef.current.length === 0) {
        hasLoadedFirstShardRef.current = true;
        setHasMore(false);
        return;
      }

      if (nextShardListIndexRef.current >= shardCatalogRef.current.length) {
        setHasMore(false);
        return;
      }

      const shardDoc = shardCatalogRef.current[nextShardListIndexRef.current];
      nextShardListIndexRef.current += 1;
      hasLoadedFirstShardRef.current = true;
      setHasMore(nextShardListIndexRef.current < shardCatalogRef.current.length);

      const items: Receipt[] = expandReceiptDocs([shardDoc]);
      if (items.length > 0) {
        setReceipts((prev) => mergeIncomingReceipts(prev, items));
      }
    } catch {
      // silently fail
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [authLoading, expandReceiptDocs, mergeIncomingReceipts, isFirebaseReady, firebaseUID, hasMore, fetchOwnerReceiptDocs, toShardCatalog]);

  const refreshLatest = useCallback(async () => {
    if (authLoading || !tokenRef.current || !userEmailRef.current || isLoadingMoreRef.current || !isFirebaseReady || !firebaseUID) return;

    try {
      const ownerDocs = await fetchOwnerReceiptDocs();
      const shardCatalog = toShardCatalog(ownerDocs);

      shardCatalogRef.current = shardCatalog;
      nextShardListIndexRef.current = shardCatalog.length > 0 ? 1 : 0;
      hasLoadedFirstShardRef.current = true;
      setHasMore(shardCatalog.length > 1);

      if (shardCatalog.length === 0) {
        setReceipts((prev) => prev.filter((receipt) => receipt.status !== "success"));
        return;
      }

      const items: Receipt[] = expandReceiptDocs([shardCatalog[0]]);
      setReceipts((prev) => mergeIncomingReceipts(prev, items));
    } catch {
      // no-op; keep existing list
    }
  }, [authLoading, expandReceiptDocs, mergeIncomingReceipts, isFirebaseReady, firebaseUID, fetchOwnerReceiptDocs, toShardCatalog]);

  useEffect(() => {
    const wasPaused = wasPollingPausedRef.current;
    wasPollingPausedRef.current = pollingPaused;
    if (pollingPaused) return;
    if (authLoading || !tokenRef.current || !isFirebaseReady || !firebaseUID) return;
    // Run once on initial visible load, and again whenever returning from paused state.
    if (!hasLoadedFirstShardRef.current || wasPaused) {
      void refreshLatest();
    }
  }, [pollingPaused, authLoading, token, refreshLatest, isFirebaseReady, firebaseUID]);

  useEffect(() => {
    return () => {
      if (postUploadRefreshTimerRef.current) window.clearTimeout(postUploadRefreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleCategoryUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ receiptId?: string; category?: string }>;
      const receiptId = customEvent.detail?.receiptId;
      if (!receiptId) return;
      if (typeof customEvent.detail?.category === "string") {
        const nextCategory = customEvent.detail.category;
        setReceipts((prev) => prev.map((r) => (r.id === receiptId ? { ...r, category: nextCategory } : r)));
      }
    };

    window.addEventListener("receipt-category-updated", handleCategoryUpdated);
    return () => {
      window.removeEventListener("receipt-category-updated", handleCategoryUpdated);
    };
  }, []);

  return {
    receipts,
    receiptsByDate,
    isUploading,
    isLoadingMore,
    hasMore,
    uploadReceipt,
    uploadReceiptImage,
    replaceReceiptImage,
    createReceiptViaSignedUpload,
    removeReceipt,
    retryUpload,
    fetchReceipt,
    fetchAllReceipts,
    loadNextPage,
    refreshLatest,
  };
}
