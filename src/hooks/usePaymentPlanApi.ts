import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";

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

export function usePaymentPlanApi() {
  const { token, isLoading: authLoading } = useAuth();
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    if (!tokenRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/billing/helcim/payment-plans`);
      if (!response.ok) throw new Error("Failed to fetch payment plans");
      const json = await response.json();
      setPlans(json.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !token) return;
    fetchPlans();
  }, [authLoading, token, fetchPlans]);

  return { plans, isLoading, error, refetch: fetchPlans };
}
