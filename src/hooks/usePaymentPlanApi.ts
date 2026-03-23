import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface PaymentPlan {
  id: number;
  name: string;
  description: string;
  status: string;
  currency: string;
  recurringAmount: number;
  billingPeriod: string;
  defaultPaymentLinkId: number;
  features?: string[];
}

const API_BASE_URL = "https://ai-receipt-tracker-backend-267658267276.northamerica-northeast2.run.app";

export function usePaymentPlanApi() {
  const { token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAuthHeaders = useCallback(() => ({
    Authorization: `Bearer ${tokenRef.current}`,
  }), []);

  const fetchPlans = useCallback(async () => {
    if (!tokenRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/billing/helcim/payment-plans`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error("Failed to fetch payment plans");
      const json = await response.json();
      setPlans(json.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  return { plans, isLoading, error, refetch: fetchPlans };
}
