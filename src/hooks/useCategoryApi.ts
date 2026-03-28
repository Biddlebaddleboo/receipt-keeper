import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { FieldPath, addDoc, collection, deleteField, doc, getDocs, query, updateDoc, where } from "firebase/firestore/lite";
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
  const categoriesContainerDocIdRef = useRef<string | null>(null);

  const fetchCategories = useCallback(async () => {
    if (!tokenRef.current || !isFirebaseReady || !firebaseUID || !userEmailRef.current) return;

    setIsLoading(true);
    setError(null);
    try {
      const authEmail = (userEmailRef.current || "").trim();
      const normalizedEmail = authEmail.toLowerCase();
      const snapshots = [];
      snapshots.push(
        await getDocs(query(collection(db, "categories"), where("owner_email", "==", authEmail)))
      );
      if (normalizedEmail && normalizedEmail !== authEmail) {
        snapshots.push(
          await getDocs(query(collection(db, "categories"), where("owner_email", "==", normalizedEmail)))
        );
      }

      const docsById = new Map<string, (typeof snapshots)[number]["docs"][number]>();
      snapshots.forEach((snap) => snap.docs.forEach((d) => docsById.set(d.id, d)));
      const docs = Array.from(docsById.values());
      let containerDocId: string | null = null;

      docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const categoriesMap = data.categories as { [key: string]: unknown } | undefined;

        if (categoriesMap && typeof categoriesMap === "object" && !Array.isArray(categoriesMap)) {
          if (!containerDocId) containerDocId = d.id;
          return;
        }
      });

      categoriesContainerDocIdRef.current = containerDocId;
      const items: Category[] = [];
      docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const categoriesMap = data.categories as { [key: string]: unknown } | undefined;
        if (categoriesMap && typeof categoriesMap === "object" && !Array.isArray(categoriesMap)) {
          Object.entries(categoriesMap).forEach(([name, rawDescription]) => {
            const trimmedName = name.trim();
            if (!trimmedName) return;
            const description = typeof rawDescription === "string" ? rawDescription : "";
            const existingIndex = items.findIndex((c) => c.name === trimmedName);
            if (existingIndex >= 0) {
              items[existingIndex] = { id: trimmedName, name: trimmedName, description };
            } else {
              items.push({ id: trimmedName, name: trimmedName, description });
            }
          });
        }
      });
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

    const categoryName = name.trim();
    if (!categoryName) throw new Error("Category name is required");
    const categoryDescription = description.trim();
    const categoryValue: string | null = categoryDescription ? categoryDescription : null;

    const containerDocId = categoriesContainerDocIdRef.current;
    if (containerDocId) {
      await updateDoc(
        doc(db, "categories", containerDocId),
        new FieldPath("categories", categoryName),
        categoryValue
      );
    } else {
      const created = await addDoc(collection(db, "categories"), {
        owner_email: userEmailRef.current.toLowerCase(),
        categories: {
          [categoryName]: categoryValue,
        },
      });
      categoriesContainerDocIdRef.current = created.id;
    }

    const newCat: Category = {
      id: categoryName,
      name: categoryName,
      description: categoryDescription,
    };
    setCategories((prev) => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)));
    return newCat;
  };

  const updateCategory = async (id: string, updates: { name?: string; description?: string }) => {
    if (!tokenRef.current || !isFirebaseReady || !firebaseUID || !userEmailRef.current) {
      throw new Error("Not authenticated");
    }

    const oldName = id.trim();
    const nextName = typeof updates.name === "string" ? updates.name.trim() : oldName;
    if (!oldName || !nextName) throw new Error("Category name is required");
    const existingCategory = categories.find((c) => c.id === id || c.name === oldName);
    const nextDescription =
      typeof updates.description === "string" ? updates.description.trim() : (existingCategory?.description ?? "");
    const nextValue: string | null = nextDescription ? nextDescription : null;

    const containerDocId = categoriesContainerDocIdRef.current;
    if (!containerDocId) {
      const created = await addDoc(collection(db, "categories"), {
        owner_email: userEmailRef.current.toLowerCase(),
        categories: {
          [nextName]: nextValue,
        },
      });
      categoriesContainerDocIdRef.current = created.id;
    } else if (oldName !== nextName) {
      const containerRef = doc(db, "categories", containerDocId);
      await updateDoc(containerRef, new FieldPath("categories", oldName), deleteField());
      await updateDoc(containerRef, new FieldPath("categories", nextName), nextValue);
    } else {
      await updateDoc(
        doc(db, "categories", containerDocId),
        new FieldPath("categories", nextName),
        nextValue
      );
    }

    const updated: Category = {
      id: nextName,
      name: nextName,
      description: nextDescription,
    };
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name))
    );
    return updated;
  };

  const deleteCategory = async (id: string) => {
    if (!tokenRef.current || !isFirebaseReady || !firebaseUID) throw new Error("Not authenticated");
    const categoryName = id.trim();
    const containerDocId = categoriesContainerDocIdRef.current;
    if (containerDocId) {
      await updateDoc(
        doc(db, "categories", containerDocId),
        new FieldPath("categories", categoryName),
        deleteField()
      );
    }
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  return { categories, isLoading, error, createCategory, updateCategory, deleteCategory, refetch: fetchCategories };
}
