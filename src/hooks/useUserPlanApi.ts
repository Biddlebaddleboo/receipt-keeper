import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore/lite";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
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

const DEFAULT_FREE_PLAN: UserPlan = {
  owner_email: "",
  plan_id: "free",
  plan_name: "Free",
  description: "",
  subscription_status: "inactive",
  plan_interval: "month",
  monthly_limit: null,
  plan_price_cents: 0,
  features: [],
  plan_updated_at: "",
  last_transaction_id: null,
  customer_code: null,
  payment_method_saved: false,
};

export function useUserPlanApi() {
  const { token, user, isLoading: authLoading } = useAuth();
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const userEmailRef = useRef(user?.email ?? null);
  useEffect(() => {
    userEmailRef.current = user?.email ?? null;
  }, [user?.email]);

  const [userPlan, setUserPlan] = useState<UserPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstWord = (value: string) => value.trim().split(/\s+/)[0];

  const mapPlan = (data: Record<string, unknown>): UserPlan => {
    const rawPlanName =
      typeof data.plan_name === "string" && data.plan_name.trim()
        ? data.plan_name
        : typeof data.plan_id === "string" && data.plan_id.trim()
          ? data.plan_id
          : "free";

    const normalizedPlanName = firstWord(rawPlanName);

    return ({
    owner_email: typeof data.owner_email === "string" ? data.owner_email : "",
    plan_id: typeof data.plan_id === "string" && data.plan_id.trim() ? data.plan_id : normalizedPlanName,
    plan_name: normalizedPlanName,
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
  });
  };

  const fetchUserPlan = useCallback(async () => {
    if (!tokenRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      let currentUser = firebaseAuth.currentUser;
      if (!currentUser) {
        const firebaseCredential = GoogleAuthProvider.credential(tokenRef.current);
        const authResult = await signInWithCredential(firebaseAuth, firebaseCredential);
        currentUser = authResult.user;
      }

      if (!currentUser) {
        throw new Error("Unable to establish Firebase authentication");
      }

      const userRef = doc(db, "users", currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        setUserPlan(mapPlan(userSnap.data() as Record<string, unknown>));
        return;
      }

      const authEmail = userEmailRef.current;
      if (!authEmail) {
        setUserPlan(DEFAULT_FREE_PLAN);
        return;
      }
      const fallbackQuery = query(collection(db, "users"), where("owner_email", "==", authEmail), limit(1));
      const fallbackSnap = await getDocs(fallbackQuery);
      if (fallbackSnap.empty) {
        setUserPlan({ ...DEFAULT_FREE_PLAN, owner_email: authEmail });
        return;
      }
      const fallbackData = fallbackSnap.docs[0].data() as Record<string, unknown>;
      setUserPlan(mapPlan(fallbackData));
    } catch (e: any) {
      setError(e?.code ? `${e.code}: ${e.message}` : e.message);
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
