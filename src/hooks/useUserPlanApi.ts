import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/config";

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
