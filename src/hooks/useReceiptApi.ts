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
  method: "PUT";
  headers: Record<string, string>;
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
}

export function useReceiptApi() {
  const RECEIPTS_PAGE_SIZE = 10;
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

  const uploadToGCS = async (
    uploadUrl: string,
    file: File,
    headers: Record<string, string>,
    onProgress?: UploadProgressCallback
  ) => {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      xhr.withCredentials = false;

      xhr.upload.onprogress = (event) => {
        if (!onProgress || !event.lengthComputable) return;
        const uploadPct = Math.round((event.loaded / event.total) * 80); // 15..95 range reserved for upload
        onProgress(Math.min(95, Math.max(15, 15 + uploadPct)));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`GCS upload failed: ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("GCS upload failed"));
      xhr.onabort = () => reject(new Error("GCS upload aborted"));
      xhr.send(file);
    });
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
    onProgress?.(5);
    const signed = await getSignedUpload(file);
    onProgress?.(15);
    await uploadToGCS(signed.upload_url, file, signed.headers, onProgress);
    onProgress?.(96);
    const finalized = await finalizeUpload(signed.storage_path, meta);
    onProgress?.(100);
    return finalized;
  };

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const hasMoreRef = useRef(hasMore);
  const nextCursorRef = useRef(nextCursor);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

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
    });
  }, [normalizeReceipt]);

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
    } catch (error) {
      onProgress?.(0);
      const message = error instanceof Error ? error.message : "Upload failed";
      setReceipts((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "error" as const, errorMessage: message } : r))
      );
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
      const receiptRef = doc(db, "receipts", id);
      const snapshot = await getDoc(receiptRef);
      if (!snapshot.exists()) return null;
      const data = snapshot.data() as Record<string, unknown>;
      if ((typeof data.owner_email === "string" ? data.owner_email : "") !== userEmailRef.current) return null;
      return fromFirestoreDoc(snapshot.id, data);
    } catch {
      return null;
    }
  }, [authLoading, fromFirestoreDoc, isFirebaseReady, firebaseUID]);

  const loadNextPage = useCallback(async () => {
    if (authLoading || isLoadingMoreRef.current || !hasMoreRef.current || !tokenRef.current || !userEmailRef.current || !isFirebaseReady || !firebaseUID) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const cursor = nextCursorRef.current;
      let firestoreQuery = query(
        collection(db, "receipts"),
        where("owner_email", "==", userEmailRef.current),
        orderBy("created_at", "desc"),
        limit(RECEIPTS_PAGE_SIZE),
      );

      if (cursor) {
        const afterSnapshot = await getDoc(doc(db, "receipts", cursor));
        if (afterSnapshot.exists()) {
          firestoreQuery = query(
            collection(db, "receipts"),
            where("owner_email", "==", userEmailRef.current),
            orderBy("created_at", "desc"),
            startAfter(afterSnapshot),
            limit(RECEIPTS_PAGE_SIZE),
          );
        }
      }

      const snapshot = await getDocs(firestoreQuery);
      const items: Receipt[] = snapshot.docs.map((d) => fromFirestoreDoc(d.id, d.data() as Record<string, unknown>));
      if (items.length === 0) {
        hasMoreRef.current = false;
        setHasMore(false);
      } else {
        setReceipts((prev) => mergeIncomingReceipts(prev, items));
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.docs.length < RECEIPTS_PAGE_SIZE) {
          hasMoreRef.current = false;
          setHasMore(false);
        } else if (lastDoc) {
          nextCursorRef.current = lastDoc.id;
          setNextCursor(lastDoc.id);
        } else {
          hasMoreRef.current = false;
          setHasMore(false);
        }
      }
    } catch {
      // silently fail
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [authLoading, fromFirestoreDoc, mergeIncomingReceipts, isFirebaseReady, firebaseUID]);

  const refreshLatest = useCallback(async () => {
    if (authLoading || !tokenRef.current || !userEmailRef.current || isLoadingMoreRef.current || !isFirebaseReady || !firebaseUID) return;

    try {
      const snapshot = await getDocs(
        query(
          collection(db, "receipts"),
          where("owner_email", "==", userEmailRef.current),
          orderBy("created_at", "desc"),
          limit(RECEIPTS_PAGE_SIZE),
        )
      );
      const items: Receipt[] = snapshot.docs.map((d) => fromFirestoreDoc(d.id, d.data() as Record<string, unknown>));
      if (items.length > 0) {
        setReceipts((prev) => mergeIncomingReceipts(prev, items));
      }
    } catch {
      // no-op; keep existing list
    }
  }, [authLoading, fromFirestoreDoc, mergeIncomingReceipts, isFirebaseReady, firebaseUID]);

  useEffect(() => {
    if (authLoading || !tokenRef.current || !isFirebaseReady || !firebaseUID) return;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refreshLatest();
    };

    tick();
    pollTimerRef.current = window.setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);

    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      document.removeEventListener("visibilitychange", tick);
    };
  }, [authLoading, token, refreshLatest, isFirebaseReady, firebaseUID]);

  useEffect(() => {
    const handleCategoryUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ receiptId?: string }>;
      const receiptId = customEvent.detail?.receiptId;
      if (!receiptId || !userEmailRef.current || !isFirebaseReady || !firebaseUID) return;

      void (async () => {
        try {
          const snapshot = await getDoc(doc(db, "receipts", receiptId));
          if (!snapshot.exists()) return;
          const data = snapshot.data() as Record<string, unknown>;
          if ((typeof data.owner_email === "string" ? data.owner_email : "") !== userEmailRef.current) return;
          const updated = fromFirestoreDoc(snapshot.id, data);
          setReceipts((prev) => prev.map((r) => (r.id === receiptId ? { ...r, category: updated.category } : r)));
        } catch {
          // keep current UI state if refresh fails
        }
      })();
    };

    window.addEventListener("receipt-category-updated", handleCategoryUpdated);
    return () => {
      window.removeEventListener("receipt-category-updated", handleCategoryUpdated);
    };
  }, [fromFirestoreDoc, isFirebaseReady, firebaseUID]);

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
  };
}
