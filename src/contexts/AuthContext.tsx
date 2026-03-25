import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { updateAuthReadyState } from "@/lib/authReady";

interface AuthContextType {
  token: string | null;
  user: { email: string; name: string; picture: string } | null;
  isLoading: boolean;
  signIn: (credential: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

function decodeJwtPayload(token: string) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

const STORAGE_KEY = "auth_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthContextType["user"]>(null);
  const [isLoading, setIsLoading] = useState(true);

  const signIn = useCallback((credential: string) => {
    const payload = decodeJwtPayload(credential);
    if (!payload) return;
    setToken(credential);
    setUser({ email: payload.email, name: payload.name, picture: payload.picture });
    localStorage.setItem(STORAGE_KEY, credential);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Restore session on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const payload = decodeJwtPayload(stored);
      if (payload && payload.exp * 1000 > Date.now()) {
        setToken(stored);
        setUser({ email: payload.email, name: payload.name, picture: payload.picture });
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  // Periodically check token expiry and auto-sign-out
  useEffect(() => {
    if (!token) return;
    const payload = decodeJwtPayload(token);
    if (!payload?.exp) return;

    const msUntilExpiry = payload.exp * 1000 - Date.now();
    if (msUntilExpiry <= 0) {
      signOut();
      return;
    }

    // Sign out 30s before actual expiry to avoid 401s
    const timeout = setTimeout(() => {
      signOut();
    }, Math.max(msUntilExpiry - 30_000, 0));

    return () => clearTimeout(timeout);
  }, [token, signOut]);

  useEffect(() => {
    updateAuthReadyState(token, isLoading);
  }, [token, isLoading]);

  return (
    <AuthContext.Provider value={{ token, user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
