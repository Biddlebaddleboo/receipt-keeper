import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { doc, getDoc } from "firebase/firestore";
import { db, firebaseAuth } from "@/lib/firebase";

export interface UserPlan {
  owner_email: string;
  plan_id: string;
  plan_name: string;
  description: string;
  subscription_status: string;
  plan_interval: string;
  monthly_limit: number | null;
  plan_price_cents: number;
  features: string[];
  plan_updated_at: string;
  last_transaction_id: number | null;
  customer_code: string | null;
  payment_method_saved: boolean;
}

export function useUserPlanApi() {
  const { token, isLoading: authLoading } = useAuth();
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [userPlan, setUserPlan] = useState<UserPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUserPlan = useCallback(async () => {
    if (!tokenRef.current) return;
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return;
    setIsLoading(true);
    setError(null);
    try {
      const userRef = doc(db, "users", currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        setUserPlan(null);
        return;
      }

      const data = userSnap.data() as Record<string, unknown>;
      const mapped: UserPlan = {
        owner_email: typeof data.owner_email === "string" ? data.owner_email : "",
        plan_id: typeof data.plan_id === "string" ? data.plan_id : "free",
        plan_name: typeof data.plan_name === "string" ? data.plan_name : "free",
        description: typeof data.description === "string" ? data.description : "",
        subscription_status: typeof data.subscription_status === "string" ? data.subscription_status : "inactive",
        plan_interval: typeof data.plan_interval === "string" ? data.plan_interval : "month",
        monthly_limit: typeof data.monthly_limit === "number" ? data.monthly_limit : null,
        plan_price_cents: typeof data.plan_price_cents === "number" ? data.plan_price_cents : 0,
        features: Array.isArray(data.features) ? data.features.filter((f): f is string => typeof f === "string") : [],
        plan_updated_at: typeof data.plan_updated_at === "string" ? data.plan_updated_at : "",
        last_transaction_id: typeof data.last_transaction_id === "number" ? data.last_transaction_id : null,
        customer_code: typeof data.customer_code === "string" ? data.customer_code : null,
        payment_method_saved: Boolean(data.payment_method_saved),
      };

      setUserPlan(mapped);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !token) return;
    fetchUserPlan();
  }, [authLoading, token, fetchUserPlan]);

  return { userPlan, isLoading, error, refetch: fetchUserPlan };
}
