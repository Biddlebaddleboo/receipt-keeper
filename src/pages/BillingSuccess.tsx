import { useNavigate } from "react-router-dom";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const BillingSuccess = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8 text-emerald-500" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Card Information Saved!</h1>
          <p className="text-sm text-muted-foreground">
            Your cardholder information has been saved successfully. Your plan is not yet activated — we'll notify you once it's ready.
          </p>
        </div>
        <Button onClick={() => navigate("/")} className="w-full">
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
};

export default BillingSuccess;
