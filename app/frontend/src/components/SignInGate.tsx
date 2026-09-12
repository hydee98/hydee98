import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";

/** Gates an action behind a real wallet identity: connect, then prove
 * ownership by signing a nonce (see AuthContext). Renders `children` once
 * signed in with the currently-connected wallet. */
export function SignInGate({
  children,
  prompt = "Sign in with your wallet to continue.",
}: {
  children: ReactNode;
  prompt?: string;
}) {
  const { connected } = useWallet();
  const { isSignedIn, signingIn, error, signIn } = useAuth();

  if (isSignedIn) return <>{children}</>;

  return (
    <div className="signin-gate">
      <p className="muted">{prompt}</p>
      {!connected ? (
        <WalletMultiButton />
      ) : (
        <button onClick={signIn} disabled={signingIn}>
          {signingIn ? "Check your wallet…" : "Sign message to continue"}
        </button>
      )}
      {error && <p className="error-banner">{error}</p>}
    </div>
  );
}
