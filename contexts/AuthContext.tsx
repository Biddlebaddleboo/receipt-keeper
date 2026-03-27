import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut } from "firebase/auth";
import { updateAuthReadyState } from "@/lib/authReady";
import { firebaseAuth } from "@/lib/firebase";

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

const signInFirebaseWithGoogleCredential = async (credential: string) => {
  const firebaseCredential = GoogleAuthProvider.credential(credential);
  await signInWithCredential(firebaseAuth, firebaseCredential);
};

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
    void signInFirebaseWithGoogleCredential(credential).catch(() => {
      // Keep app auth functioning even if Firebase Auth is temporarily unavailable.
    });
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    void firebaseSignOut(firebaseAuth).catch(() => {
      // Ignore Firebase sign-out errors; local auth state is already cleared.
    });
  }, []);

  // Restore session on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const payload = decodeJwtPayload(stored);
      if (payload && payload.exp * 1000 > Date.now()) {
        setToken(stored);
        setUser({ email: payload.email, name: payload.name, picture: payload.picture });
        void signInFirebaseWithGoogleCredential(stored).catch(() => {
          // Don't block session restore if Firebase sign-in fails.
        });
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
