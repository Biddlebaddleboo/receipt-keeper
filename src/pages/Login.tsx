import { useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ScanLine } from "lucide-react";

import { GOOGLE_CLIENT_ID } from "@/config";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (element: HTMLElement, config: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const Login = () => {
  const navigate = useNavigate();
  const { token, signIn } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (token) navigate("/", { replace: true });
  }, [token, navigate]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (window.google && buttonRef.current) {
        clearInterval(interval);
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response: { credential: string }) => {
            signIn(response.credential);
          },
          use_fedcm_for_prompt: true,
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          width: 300,
          text: "signin_with",
          shape: "pill",
        });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [signIn]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center gap-6 max-w-sm w-full">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
          <ScanLine className="w-7 h-7 text-primary-foreground" />
        </div>
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">AI Receipt Tracker</h1>
          <p className="text-sm text-muted-foreground">Sign in to manage your receipts</p>
        </div>
        <div className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            🎉 Limited Time — Free tier receipt limit is not enforced!
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload unlimited receipts while this offer lasts.
          </p>
        </div>
        <div ref={buttonRef} className="flex justify-center" />
        <div className="flex gap-3">
          <Link to="/terms" className="text-xs text-muted-foreground underline hover:text-foreground transition-colors">
            Terms of Service
          </Link>
          <Link to="/privacy" className="text-xs text-muted-foreground underline hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>
      <p className="absolute bottom-6 text-xs text-muted-foreground">
        Designed by{" "}
        <a
          href="https://jcdigitalsolutions.ca"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground transition-colors"
        >
          JC Digital Solutions
        </a>
      </p>
    </div>
  );
};

export default Login;
