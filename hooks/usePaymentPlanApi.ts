import { useState, useCallback, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore/lite";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";

export interface PaymentPlan {
  id: string;
  name: string;
  features: string[];
  interval: string;
  monthly_limit: number | null;
  payment_plan_id: number;
  price_cents: number;
}

export function usePaymentPlanApi() {
  const { token, isLoading: authLoading, firebaseUID, isFirebaseReady } = useAuth();
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    if (!token || !isFirebaseReady || !firebaseUID) return;
    setIsLoading(true);
    setError(null);
    try {
      const querySnapshot = await getDocs(collection(db, "plans"));
      const fetchedPlans: PaymentPlan[] = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name ?? "",
        features: doc.data().features ?? [],
        interval: doc.data().interval ?? "month",
        monthly_limit: doc.data().monthly_limit ?? null,
        payment_plan_id: doc.data().payment_plan_id ?? 0,
        price_cents: doc.data().price_cents ?? 0,
      }));
      setPlans(fetchedPlans);
    } catch (e: any) {
      setError(e?.code ? `${e.code}: ${e.message}` : e.message);
    } finally {
      setIsLoading(false);
    }
  }, [token, isFirebaseReady, firebaseUID]);

  useEffect(() => {
    if (authLoading || !token || !isFirebaseReady || !firebaseUID) return;
    fetchPlans();
  }, [authLoading, token, isFirebaseReady, firebaseUID, fetchPlans]);

  return { plans, isLoading, error, refetch: fetchPlans };
}
