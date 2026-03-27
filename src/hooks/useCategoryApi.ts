import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";

export interface Category {
  id: string;
  name: string;
  description: string;
}

export function useCategoryApi() {
  const { token, user, isLoading: authLoading, isFirebaseReady, firebaseUID } = useAuth();
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const userEmailRef = useRef(user?.email ?? null);
  useEffect(() => {
    userEmailRef.current = user?.email ?? null;
  }, [user?.email]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    if (!tokenRef.current || !isFirebaseReady || !firebaseUID || !userEmailRef.current) return;

    setIsLoading(true);
    setError(null);
    try {
      const snapshot = await getDocs(
        query(collection(db, "categories"), where("owner_email", "==", userEmailRef.current))
      );
      const items: Category[] = snapshot.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: typeof data.name === "string" ? data.name : "",
            description: typeof data.description === "string" ? data.description : "",
          };
        })
        .filter((c) => c.name.trim() !== "");
      setCategories(items.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load categories");
    } finally {
      setIsLoading(false);
    }
  }, [isFirebaseReady, firebaseUID]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setCategories([]);
      setIsLoading(false);
      return;
    }
    if (!isFirebaseReady || !firebaseUID) return;
    fetchCategories();
  }, [authLoading, token, isFirebaseReady, firebaseUID, fetchCategories]);

  const createCategory = async (name: string, description = "") => {
    if (!tokenRef.current || !isFirebaseReady || !firebaseUID || !userEmailRef.current) {
      throw new Error("Not authenticated");
    }

    const payload = {
      name: name.trim(),
      description: description.trim(),
      owner_email: userEmailRef.current,
    };
    const created = await addDoc(collection(db, "categories"), payload);
    const newCat: Category = {
      id: created.id,
      name: payload.name,
      description: payload.description,
    };
    setCategories((prev) => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)));
    return newCat;
  };

  const updateCategory = async (id: string, updates: { name?: string; description?: string }) => {
    if (!tokenRef.current || !isFirebaseReady || !firebaseUID || !userEmailRef.current) {
      throw new Error("Not authenticated");
    }

    const updatePayload: Record<string, unknown> = {
      owner_email: userEmailRef.current,
    };
    if (typeof updates.name === "string") updatePayload.name = updates.name.trim();
    if (typeof updates.description === "string") updatePayload.description = updates.description.trim();

    await updateDoc(doc(db, "categories", id), updatePayload);
    const updated: Category = {
      id,
      name: typeof updatePayload.name === "string" ? updatePayload.name : "",
      description: typeof updatePayload.description === "string" ? updatePayload.description : "",
    };
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name))
    );
    return updated;
  };

  const deleteCategory = async (id: string) => {
    if (!tokenRef.current || !isFirebaseReady || !firebaseUID) throw new Error("Not authenticated");

    await deleteDoc(doc(db, "categories", id));
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  return { categories, isLoading, error, createCategory, updateCategory, deleteCategory, refetch: fetchCategories };
}
