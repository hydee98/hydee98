import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "../context/AuthContext";

function truncate(pubkey: string): string {
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

/** Header identity widget: wallet connect button, plus a "Sign in" step
 * once connected (proves wallet ownership via a signed message - see
 * AuthContext) and a signed-in indicator/sign-out once done. */
export function AccountStatus() {
  const { connected, publicKey } = useWallet();
  const { isSignedIn, signingIn, error, signOut, signIn } = useAuth();

  return (
    <div className="account-status">
      <WalletMultiButton />
      {connected && !isSignedIn && (
        <button className="secondary-button" onClick={signIn} disabled={signingIn}>
          {signingIn ? "Check wallet…" : "Sign in"}
        </button>
      )}
      {isSignedIn && publicKey && (
        <button className="secondary-button" onClick={signOut} title={publicKey.toBase58()}>
          {truncate(publicKey.toBase58())} · Sign out
        </button>
      )}
      {error && <span className="account-status-error">{error}</span>}
    </div>
  );
}
