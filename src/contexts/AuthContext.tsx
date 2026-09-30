import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { GoogleAuthProvider, onIdTokenChanged, signInWithCredential, signOut as firebaseSignOut } from "firebase/auth";
import { updateAuthReadyState } from "@/lib/authReady";
import { firebaseAuth } from "@/lib/firebase";

interface AuthContextType {
  token: string | null;
  user: { email: string; name: string; picture: string } | null;
  firebaseUID: string | null;
  isFirebaseReady: boolean;
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

const signInFirebaseWithGoogleCredential = async (credential: string) => {
  const firebaseCredential = GoogleAuthProvider.credential(credential);
  await signInWithCredential(firebaseAuth, firebaseCredential);
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthContextType["user"]>(null);
  const [firebaseUID, setFirebaseUID] = useState<string | null>(null);
  const [isFirebaseReady, setIsFirebaseReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const signIn = useCallback((credential: string) => {
    void signInFirebaseWithGoogleCredential(credential).catch(() => {
      // The app requires the Firebase Auth session before API and Firestore access.
    });
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    void firebaseSignOut(firebaseAuth).catch(() => {
      // Ignore Firebase sign-out errors; local auth state is already cleared.
    });
  }, []);

  // Firebase Auth owns session persistence and provides ID tokens for the backend.
  useEffect(() => {
    localStorage.removeItem("auth_token");
    let eventID = 0;
    const unsubscribe = onIdTokenChanged(firebaseAuth, async (firebaseUser) => {
      const currentEventID = ++eventID;
      setFirebaseUID(firebaseUser?.uid ?? null);
      setIsFirebaseReady(true);

      if (!firebaseUser) {
        setToken(null);
        setUser(null);
        setIsLoading(false);
        return;
      }

      try {
        const idToken = await firebaseUser.getIdToken();
        if (currentEventID !== eventID) return;
        setToken(idToken);
        setUser({
          email: firebaseUser.email ?? "",
          name: firebaseUser.displayName ?? "",
          picture: firebaseUser.photoURL ?? "",
        });
        setIsLoading(false);
      } catch {
        if (currentEventID !== eventID) return;
        setToken(null);
        setUser(null);
        setIsLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    updateAuthReadyState(token, isLoading);
  }, [token, isLoading]);

  return (
    <AuthContext.Provider value={{ token, user, firebaseUID, isFirebaseReady, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
