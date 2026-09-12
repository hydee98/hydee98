import { useWallet } from "@solana/wallet-adapter-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { clearSession, getSessionUser, setSession, type SessionUser } from "../lib/session";

interface AuthContextValue {
  user: SessionUser | null;
  signingIn: boolean;
  error: string | null;
  /** True once the connected wallet matches an active session - the thing
   * every "requires sign-in" UI should actually check. */
  isSignedIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, connected } = useWallet();
  const [user, setUser] = useState<SessionUser | null>(() => getSessionUser());
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletKey = publicKey?.toBase58();
  const isSignedIn = Boolean(user && connected && walletKey === user.publicKey);

  // A session only means anything alongside the wallet that created it -
  // drop it the moment the wallet disconnects or switches accounts, rather
  // than silently showing a mismatched identity.
  useEffect(() => {
    if (user && (!connected || walletKey !== user.publicKey)) {
      clearSession();
      setUser(null);
    }
  }, [connected, walletKey, user]);

  const signIn = async () => {
    if (!publicKey) {
      setError("Connect a wallet first.");
      return;
    }
    if (!signMessage) {
      setError("This wallet doesn't support message signing - try Phantom or Solflare.");
      return;
    }
    setSigningIn(true);
    setError(null);
    try {
      const pk = publicKey.toBase58();
      const { message } = await api.getSignInMessage(pk);
      const signatureBytes = await signMessage(new TextEncoder().encode(message));
      const signature = bytesToBase64(signatureBytes);
      const { token, user: signedInUser } = await api.verifySignIn(pk, signature);
      setSession(token, signedInUser);
      setUser(signedInUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = () => {
    clearSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, signingIn, error, isSignedIn, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
