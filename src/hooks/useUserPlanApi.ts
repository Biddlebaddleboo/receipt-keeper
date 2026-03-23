import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

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
}

const API_BASE_URL = "https://ai-receipt-tracker-backend-267658267276.northamerica-northeast2.run.app";

export function useUserPlanApi() {
  const { token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const [userPlan, setUserPlan] = useState<UserPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUserPlan = useCallback(async () => {
    if (!tokenRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/users/me/plan`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!response.ok) throw new Error("Failed to fetch user plan");
      const json = await response.json();
      setUserPlan(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUserPlan();
  }, [fetchUserPlan]);

  return { userPlan, isLoading, error, refetch: fetchUserPlan };
}
