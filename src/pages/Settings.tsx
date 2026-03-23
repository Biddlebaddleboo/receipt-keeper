import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Tags, Moon, Sun, Check, Zap, Gift } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "@/hooks/use-toast";
import { usePaymentPlanApi, PaymentPlan } from "@/hooks/usePaymentPlanApi";
import { useUserPlanApi } from "@/hooks/useUserPlanApi";
import { Skeleton } from "@/components/ui/skeleton";

const Settings = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { userPlan, isLoading: userPlanLoading } = useUserPlanApi();
  const { plans, isLoading: plansLoading, error } = usePaymentPlanApi();

  const isLoading = userPlanLoading || plansLoading;

  const handleSubscribe = () => {
    window.open("https://jc-digital-solutions.myhelcim.com/hosted/?token=f7fd8827054adf4b085ff8", "_blank");
  };

  // Pick icon/color based on plan name
  const getPlanStyle = (plan: PaymentPlan) => {
    const lower = plan.name.toLowerCase();
    if (lower.includes("pro")) {
      return { Icon: Zap, color: "violet", bgClass: "bg-violet-500/15", iconClass: "text-violet-500", btnClass: "bg-violet-500 hover:bg-violet-600" };
    }
    return { Icon: Gift, color: "amber", bgClass: "bg-amber-500/15", iconClass: "text-amber-500", btnClass: "bg-amber-500 hover:bg-amber-600" };
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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">Subscription</h2>

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
            <div className={`rounded-xl bg-card receipt-shadow overflow-hidden ${isFreePlan ? "ring-2 ring-emerald-500" : ""}`}>
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
                  <span className="text-sm text-foreground/80">50 receipts one time</span>
                </div>
              </div>
              <div className="px-5 pb-5">
                <Button disabled className={`w-full ${isFreePlan ? "bg-emerald-500" : "bg-emerald-500/50"} text-white cursor-default`}>
                  {isFreePlan ? "Current Plan" : "Free Tier"}
                </Button>
              </div>
            </div>
          )}

          {!isLoading && !error && plans.filter((plan) => {
            const cleanName = plan.name.replace(/ - AI Receipt Tracker$/i, "");
            const planTier = PLAN_TIERS[cleanName.toLowerCase()] ?? 0;
            return planTier >= userTier;
          }).map((plan) => {
            const { Icon, bgClass, iconClass, btnClass } = getPlanStyle(plan);
            const cleanName = plan.name.replace(/ - AI Receipt Tracker$/i, "");
            const isCurrent = isCurrentPlan(cleanName);
            return (
              <div key={plan.id} className={`rounded-xl bg-card receipt-shadow overflow-hidden mt-3 ${isCurrent ? "ring-2 ring-violet-500" : ""}`}>
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
                    {plan.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>
                    )}
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
              <Switch
                checked={theme === "dark"}
                onCheckedChange={toggleTheme}
              />
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
