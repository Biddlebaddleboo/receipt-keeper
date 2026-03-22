import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Tags, Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/contexts/ThemeContext";

const Settings = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

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

      <main className="max-w-2xl mx-auto px-4 py-6">
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
      </main>
    </div>
  );
};

export default Settings;
