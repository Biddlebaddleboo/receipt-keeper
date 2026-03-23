import { useNavigate } from "react-router-dom";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const BillingCancelled = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-destructive/15 flex items-center justify-center mx-auto">
          <XCircle className="w-8 h-8 text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Payment Cancelled</h1>
          <p className="text-sm text-muted-foreground">
            Your payment was cancelled. No charges were made.
          </p>
        </div>
        <div className="space-y-3">
          <Button onClick={() => navigate("/settings")} className="w-full">
            Back to Settings
          </Button>
          <Button variant="outline" onClick={() => navigate("/")} className="w-full">
            Go to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BillingCancelled;
