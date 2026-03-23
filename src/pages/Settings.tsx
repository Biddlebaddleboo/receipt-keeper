import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Tags, Moon, Sun, Crown, Check, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "@/hooks/use-toast";

const Settings = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const handleSubscribe = () => {
    toast({
      title: "Coming soon",
      description: "Payment integration is being set up. Check back shortly!",
    });
  };

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
          <div className="rounded-xl bg-card receipt-shadow overflow-hidden">
            <div className="px-5 pt-5 pb-4 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                <Crown className="w-5 h-5 text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-semibold">Plus</span>
                  <span className="text-xs font-medium text-muted-foreground">$5.99 CAD/month</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Unlock more storage and features</p>
              </div>
            </div>
            <div className="px-5 pb-4 space-y-2">
              {[
                "100 receipts per month",
                "Priority OCR processing",
                "Export to CSV",
              ].map((feature) => (
                <div key={feature} className="flex items-center gap-2.5">
                  <Check className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <span className="text-sm text-foreground/80">{feature}</span>
                </div>
              ))}
            </div>
            <div className="px-5 pb-5">
              <Button
                onClick={handleSubscribe}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white active:scale-[0.98]"
              >
                Subscribe
              </Button>
            </div>
          </div>

          <div className="rounded-xl bg-card receipt-shadow overflow-hidden mt-3">
            <div className="px-5 pt-5 pb-4 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-violet-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-semibold">Pro</span>
                  <span className="text-xs font-medium text-muted-foreground">$11.99 CAD/month</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Everything you need, no limits</p>
              </div>
            </div>
            <div className="px-5 pb-4 space-y-2">
              {[
                "Unlimited receipts per month",
                "Priority OCR processing",
                "Export to CSV",
                "Advanced analytics",
              ].map((feature) => (
                <div key={feature} className="flex items-center gap-2.5">
                  <Check className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                  <span className="text-sm text-foreground/80">{feature}</span>
                </div>
              ))}
            </div>
            <div className="px-5 pb-5">
              <Button
                onClick={handleSubscribe}
                className="w-full bg-violet-500 hover:bg-violet-600 text-white active:scale-[0.98]"
              >
                Subscribe
              </Button>
            </div>
          </div>
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
