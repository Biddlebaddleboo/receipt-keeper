import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";

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
}

interface SignedUploadResponse {
  storage_path: string;
  upload_url: string;
  form_fields?: Record<string, string> | null;
  fields?: Record<string, string> | null;
  expires_at: string;
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
  extracted_text: string;
  extracted_fields: ExtractedField[];
  items: ReceiptItem[];
  created_at: string;
  image_url?: string;
  // Client-side fields
  file?: File;
  localImageUrl?: string;
  status: "pending" | "uploading" | "success" | "error";
  errorMessage?: string;
  storage_doc_id?: string;
  shard_doc_id?: string;
}

interface UseReceiptApiOptions {
  pollingPaused?: boolean;
}

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

  const createReceiptViaSignedUpload = async (file: File, meta?: ReceiptUploadMeta, onProgress?: UploadProgressCallback) => {
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
    onProgress?.(96);
    const finalized = await finalizeUpload(signed.storage_path, meta);
    onProgress?.(100);
    return finalized;
  };

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const postUploadRefreshTimerRef = useRef<number | null>(null);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const nextShardCursorRef = useRef<any | null>(null);
  const hasLoadedFirstShardRef = useRef(false);
  const shardModeRef = useRef<boolean | null>(null);
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

  const fromFirestoreDoc = useCallback((id: string, data: Record<string, unknown>): Receipt => {
    return normalizeReceipt({
      id,
      vendor: typeof data.vendor === "string" ? data.vendor : "",
      subtotal: typeof data.subtotal === "number" ? data.subtotal : 0,
      tax: typeof data.tax === "number" ? data.tax : 0,
      total: typeof data.total === "number" ? data.total : 0,
      category: typeof data.category === "string" ? data.category : "",
      purchase_date: typeof data.purchase_date === "string" ? data.purchase_date : "",
      extracted_text: typeof data.extracted_text === "string" ? data.extracted_text : "",
      extracted_fields: Array.isArray(data.extracted_fields) ? (data.extracted_fields as ExtractedField[]) : [],
      items: Array.isArray(data.items) ? (data.items as ReceiptItem[]) : [],
      created_at: toISOString(data.created_at),
      image_url: typeof data.image_url === "string" ? data.image_url : undefined,
      status: "success",
      storage_doc_id: id,
    });
  }, [normalizeReceipt]);

  const fromShardMetadataEntry = useCallback((shardDocId: string, receiptId: string, raw: Record<string, unknown>): Receipt => {
    return normalizeReceipt({
      id: receiptId,
      vendor: typeof raw.vendor === "string" ? raw.vendor : "",
      subtotal: typeof raw.subtotal === "number" ? raw.subtotal : 0,
      tax: typeof raw.tax === "number" ? raw.tax : 0,
      total: typeof raw.total === "number" ? raw.total : 0,
      category: typeof raw.category === "string" ? raw.category : "",
      purchase_date: typeof raw.purchase_date === "string" ? raw.purchase_date : "",
      extracted_text: typeof raw.extracted_text === "string" ? raw.extracted_text : "",
      extracted_fields: Array.isArray(raw.extracted_fields) ? (raw.extracted_fields as ExtractedField[]) : [],
      items: Array.isArray(raw.items) ? (raw.items as ReceiptItem[]) : [],
      created_at: toISOString(raw.created_at),
      image_url: typeof raw.image_url === "string" ? raw.image_url : undefined,
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
      } else {
        expanded.push(fromFirestoreDoc(id, data));
      }
    });

    expanded.sort((a, b) => {
      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return bt - at;
    });
    return expanded;
  }, [fromFirestoreDoc, fromShardMetadataEntry]);

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

  const uploadReceipt = async (file: File, onProgress?: UploadProgressCallback) => {
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
      extracted_text: "",
      extracted_fields: [],
      items: [],
      created_at: new Date().toISOString(),
      localImageUrl,
      file,
      status: "uploading",
    };

    setReceipts((prev) => [newReceipt, ...prev]);
    setIsUploading(true);

    try {
      const data = (await createReceiptViaSignedUpload(file, undefined, onProgress)) as Record<string, unknown>;

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
      ? new Date(receipt.purchase_date).toLocaleDateString("en-US", {
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
      // Legacy structure: one receipt per document.
      const receiptRef = doc(db, "receipts", id);
      const snapshot = await getDoc(receiptRef);
      if (snapshot.exists()) {
        const data = snapshot.data() as Record<string, unknown>;
        if ((typeof data.owner_email === "string" ? data.owner_email : "") !== userEmailRef.current) return null;
        const schema = typeof data._schema === "string" ? data._schema : "";
        if (schema !== "receipt_shard") {
          return fromFirestoreDoc(snapshot.id, data);
        }
      }

      // New structure: receipt metadata entries inside shard docs.
      const shardSnapshot = await getDocs(
        query(
          collection(db, "receipts"),
          where("owner_email", "==", userEmailRef.current),
          orderBy("updated_at", "desc"),
          limit(25)
        )
      );

      for (const shardDoc of shardSnapshot.docs) {
        const data = shardDoc.data() as Record<string, unknown>;
        const schema = typeof data._schema === "string" ? data._schema : "";
        if (schema !== "receipt_shard") continue;
        const receiptMetadata = data.receipt_metadata as { [key: string]: unknown } | undefined;
        if (!receiptMetadata || typeof receiptMetadata !== "object" || Array.isArray(receiptMetadata)) continue;
        const rawMeta = receiptMetadata[id];
        if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) continue;
        return fromShardMetadataEntry(shardDoc.id, id, rawMeta as Record<string, unknown>);
      }

      return null;
    } catch {
      return null;
    }
  }, [authLoading, fromFirestoreDoc, fromShardMetadataEntry, isFirebaseReady, firebaseUID]);

  const loadNextPage = useCallback(async () => {
    if (authLoading || isLoadingMoreRef.current || !tokenRef.current || !userEmailRef.current || !isFirebaseReady || !firebaseUID) return;
    // If we've exhausted shard pages, do nothing.
    if (hasLoadedFirstShardRef.current && shardModeRef.current === true && !hasMore) return;

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const q = nextShardCursorRef.current
        ? query(
            collection(db, "receipts"),
            where("owner_email", "==", userEmailRef.current),
            where("_schema", "==", "receipt_shard"),
            orderBy("shard_index", "desc"),
            startAfter(nextShardCursorRef.current),
            limit(1),
          )
        : query(
            collection(db, "receipts"),
            where("owner_email", "==", userEmailRef.current),
            where("_schema", "==", "receipt_shard"),
            orderBy("shard_index", "desc"),
            limit(1),
          );

      const shardSnapshot = await getDocs(q);

      // No more shard docs.
      if (shardSnapshot.empty) {
        if (!hasLoadedFirstShardRef.current) {
          // Legacy fallback once, if shard format not present.
          const legacySnapshot = await getDocs(
            query(
              collection(db, "receipts"),
              where("owner_email", "==", userEmailRef.current),
              orderBy("created_at", "desc"),
            )
          );
          const legacyItems: Receipt[] = expandReceiptDocs(
            legacySnapshot.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
          );
          if (legacyItems.length > 0) {
            setReceipts((prev) => mergeIncomingReceipts(prev, legacyItems));
          }
          shardModeRef.current = false;
          hasLoadedFirstShardRef.current = true;
        } else {
          setHasMore(false);
        }
        return;
      }

      shardModeRef.current = true;
      hasLoadedFirstShardRef.current = true;
      nextShardCursorRef.current = shardSnapshot.docs[shardSnapshot.docs.length - 1] ?? null;
      // Keep enabled until next click proves empty.
      setHasMore(true);

      const items: Receipt[] = expandReceiptDocs(
        shardSnapshot.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
      );
      if (items.length > 0) {
        setReceipts((prev) => mergeIncomingReceipts(prev, items));
      }
    } catch {
      // silently fail
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [authLoading, expandReceiptDocs, mergeIncomingReceipts, isFirebaseReady, firebaseUID, hasMore]);

  const refreshLatest = useCallback(async () => {
    if (authLoading || !tokenRef.current || !userEmailRef.current || isLoadingMoreRef.current || !isFirebaseReady || !firebaseUID) return;

    try {
      if (shardModeRef.current !== false) {
        const latestShardSnapshot = await getDocs(
          query(
            collection(db, "receipts"),
            where("owner_email", "==", userEmailRef.current),
            where("_schema", "==", "receipt_shard"),
            orderBy("shard_index", "desc"),
            limit(1),
          )
        );
        if (!latestShardSnapshot.empty) {
          const items: Receipt[] = expandReceiptDocs(
            latestShardSnapshot.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
          );
          if (items.length > 0) {
            setReceipts((prev) => mergeIncomingReceipts(prev, items));
          }
          if (!hasLoadedFirstShardRef.current) {
            nextShardCursorRef.current = latestShardSnapshot.docs[latestShardSnapshot.docs.length - 1] ?? null;
            hasLoadedFirstShardRef.current = true;
            shardModeRef.current = true;
            setHasMore(true);
          }
          return;
        }
      }

      // Legacy fallback refresh.
      const legacySnapshot = await getDocs(
        query(
          collection(db, "receipts"),
          where("owner_email", "==", userEmailRef.current),
          orderBy("created_at", "desc"),
        )
      );
      const legacyItems: Receipt[] = expandReceiptDocs(
        legacySnapshot.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
      );
      if (legacyItems.length > 0) {
        setReceipts((prev) => mergeIncomingReceipts(prev, legacyItems));
      }
    } catch {
      // no-op; keep existing list
    }
  }, [authLoading, expandReceiptDocs, mergeIncomingReceipts, isFirebaseReady, firebaseUID]);

  useEffect(() => {
    const wasPaused = wasPollingPausedRef.current;
    wasPollingPausedRef.current = pollingPaused;
    if (pollingPaused) return;
    // Only refresh when returning from paused state (detail/add overlay closed).
    if (!wasPaused) return;
    if (authLoading || !tokenRef.current || !isFirebaseReady || !firebaseUID) return;
    void refreshLatest();
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
    removeReceipt,
    retryUpload,
    fetchReceipt,
    loadNextPage,
    refreshLatest,
  };
}
