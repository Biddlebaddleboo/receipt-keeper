import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Tags, Moon, Sun, Check, Zap, Gift } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "@/hooks/use-toast";
import { usePaymentPlanApi, PaymentPlan } from "@/hooks/usePaymentPlanApi";
import { useUserPlanApi } from "@/hooks/useUserPlanApi";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CreditCard, AlertTriangle } from "lucide-react";
import { PAYMENT_PAGE_URL, API_BASE_URL } from "@/config";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const Settings = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { token } = useAuth();
  const { userPlan, isLoading: userPlanLoading, refetch: refetchUserPlan } = useUserPlanApi();
  const { plans, isLoading: plansLoading, error } = usePaymentPlanApi();

  const [confirmPlan, setConfirmPlan] = useState<{ id: string; name: string; amount: string } | null>(null);
  const [isActivating, setIsActivating] = useState(false);

  const isLoading = userPlanLoading || plansLoading;

  const paymentMethodSaved = userPlan?.payment_method_saved ?? false;

  const handleSubscribe = (planId: string, planName: string, amount: string) => {
    setConfirmPlan({ id: planId, name: planName, amount });
  };

  const handleConfirmSubscribe = async () => {
    if (!confirmPlan || !token) return;
    setIsActivating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/billing/subscriptions/activate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan_id: confirmPlan.id }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Failed to activate subscription");
      }
      toast({ title: "Subscription activated!", description: `You are now on the ${confirmPlan.name} plan.` });
      refetchUserPlan();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsActivating(false);
      setConfirmPlan(null);
    }
  };

  const handleAddPaymentMethod = () => {
    window.open(PAYMENT_PAGE_URL, "_blank");
  };

  // Pick icon/color based on plan name
  const getPlanStyle = (plan: PaymentPlan) => {
    const lower = plan.name.toLowerCase();
    if (lower.includes("pro")) {
      return {
        Icon: Zap,
        color: "violet",
        bgClass: "bg-violet-500/15",
        iconClass: "text-violet-500",
        btnClass: "bg-violet-500 hover:bg-violet-600",
      };
    }
    return {
      Icon: Gift,
      color: "amber",
      bgClass: "bg-amber-500/15",
      iconClass: "text-amber-500",
      btnClass: "bg-amber-500 hover:bg-amber-600",
    };
  };

  const formatBillingPeriod = (period: string) => {
    if (period === "monthly") return "month";
    if (period === "yearly") return "year";
    return period;
  };

  // Plan tier hierarchy (higher index = higher tier)
  const PLAN_TIERS: Record<string, number> = { free: 0, plus: 1, pro: 2 };

  const getUserTier = () => {
    if (!userPlan) return 0;
    return PLAN_TIERS[userPlan.plan_name.toLowerCase()] ?? 0;
  };

  const isCurrentPlan = (planName: string) => {
    if (!userPlan) return false;
    return userPlan.plan_name.toLowerCase() === planName.toLowerCase();
  };

  const isFreePlan = !userPlan || userPlan.plan_id === "free";
  const userTier = getUserTier();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold leading-tight tracking-tight">Settings</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Subscription */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
            Subscription
          </h2>

          {!isLoading && !error && paymentMethodSaved && (
            <Alert className="mb-3 border-emerald-500/30 bg-emerald-500/10">
              <CreditCard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <AlertDescription className="text-sm text-emerald-600 dark:text-emerald-400">
                Your payment method is currently saved.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !error && !paymentMethodSaved && (
            <Alert className="mb-3 border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-sm text-amber-600 dark:text-amber-400 flex items-center justify-between gap-2 flex-wrap">
                <span>Add your payment method first before upgrading.</span>
                <Button
                  size="sm"
                  onClick={handleAddPaymentMethod}
                  className="bg-amber-500 hover:bg-amber-600 text-white"
                >
                  <CreditCard className="w-4 h-4 mr-1" />
                  Add Payment Method
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-card receipt-shadow p-5 text-sm text-muted-foreground">
              Unable to load plans. Please try again later.
            </div>
          )}

          {!isLoading && !error && plans.length === 0 && (
            <div className="rounded-xl bg-card receipt-shadow p-5 text-sm text-muted-foreground">
              No plans available at this time.
            </div>
          )}

          {/* Free plan - always shown */}
          {!isLoading && !error && userTier === 0 && (
            <div
              className={`rounded-xl bg-card receipt-shadow overflow-hidden ${isFreePlan ? "ring-2 ring-emerald-500" : ""}`}
            >
              <div className="px-5 pt-5 pb-4 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                  <Gift className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-semibold">Free</span>
                    <span className="text-xs font-medium text-muted-foreground">$0.00 CAD</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Get started at no cost</p>
                </div>
              </div>
              <div className="px-5 pb-4 space-y-2">
                <div className="flex items-center gap-2.5">
                  <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span className="text-sm text-foreground/80">50 receipts lifetime with OCR</span>
                </div>
              </div>
              <div className="px-5 pb-5">
                <Button
                  disabled
                  className={`w-full ${isFreePlan ? "bg-emerald-500" : "bg-emerald-500/50"} text-white cursor-default`}
                >
                  {isFreePlan ? "Current Plan" : "Free Tier"}
                </Button>
              </div>
            </div>
          )}

          {!isLoading &&
            !error &&
            plans
              .filter((plan) => {
                const cleanName = plan.name.split(" ")[0];
                const planTier = PLAN_TIERS[cleanName.toLowerCase()] ?? 0;
                return planTier >= userTier;
              })
              .map((plan) => {
                const { Icon, bgClass, iconClass, btnClass } = getPlanStyle(plan);
                const cleanName = plan.name.split(" ")[0];
                const isCurrent = isCurrentPlan(cleanName);
                return (
                  <div
                    key={plan.id}
                    className={`rounded-xl bg-card receipt-shadow overflow-hidden mt-3 ${isCurrent ? "ring-2 ring-violet-500" : ""}`}
                  >
                    <div className="px-5 pt-5 pb-4 flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl ${bgClass} flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`w-5 h-5 ${iconClass}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-base font-semibold">{cleanName}</span>
                          <span className="text-xs font-medium text-muted-foreground">
                            ${plan.recurringAmount.toFixed(2)} {plan.currency}/{formatBillingPeriod(plan.billingPeriod)}
                          </span>
                        </div>
                        {plan.description && <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>}
                      </div>
                    </div>
                    {plan.features && plan.features.length > 0 && (
                      <div className="px-5 pb-4 space-y-2">
                        {plan.features.map((feature) => (
                          <div key={feature} className="flex items-center gap-2.5">
                            <Check className={`w-3.5 h-3.5 ${iconClass} flex-shrink-0`} />
                            <span className="text-sm text-foreground/80">{feature}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="px-5 pb-5">
                      {isCurrent ? (
                        <Button disabled className={`w-full ${btnClass} text-white cursor-default`}>
                          Current Plan{userPlan?.subscription_status === "active" ? " · Active" : ""}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handleSubscribe()}
                          disabled={!paymentMethodSaved}
                          className={`w-full ${btnClass} text-white active:scale-[0.98]`}
                        >
                          Subscribe
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
        </div>

        {/* General */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">General</h2>
          <div className="space-y-1">
            <div className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-lg bg-card receipt-shadow">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                {theme === "dark" ? (
                  <Moon className="w-4.5 h-4.5 text-primary" />
                ) : (
                  <Sun className="w-4.5 h-4.5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium block">Dark Mode</span>
                <span className="text-xs text-muted-foreground">
                  {theme === "dark" ? "Dark theme active" : "Light theme active"}
                </span>
              </div>
              <Switch checked={theme === "dark"} onCheckedChange={toggleTheme} />
            </div>

            <button
              onClick={() => navigate("/settings/categories")}
              className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-lg bg-card hover:bg-secondary/60 receipt-shadow transition-all text-left group active:scale-[0.98]"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Tags className="w-4.5 h-4.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium block">Categories</span>
                <span className="text-xs text-muted-foreground">Manage receipt categories</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Settings;
