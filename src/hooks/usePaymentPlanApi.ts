import { useState, useCallback, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
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
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const querySnapshot = await getDocs(collection(db, "payment_plans"));
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
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  return { plans, isLoading, error, refetch: fetchPlans };
}
