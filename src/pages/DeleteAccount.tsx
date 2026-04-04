import { useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const DeleteAccount = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate("/settings")}
            className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold leading-tight tracking-tight">Delete Account</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <Alert className="border-destructive/30 bg-destructive/10">
          <Trash2 className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-sm text-destructive">
            To delete your account and all associated data, please email{" "}
            <a
              href="mailto:info@jcdigitalsolutions.ca"
              className="underline font-medium"
            >
              info@jcdigitalsolutions.ca
            </a>
          </AlertDescription>
        </Alert>
      </main>
    </div>
  );
};

export default DeleteAccount;
