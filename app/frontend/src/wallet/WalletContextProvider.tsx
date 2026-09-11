import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { ReactNode } from "react";

import "@solana/wallet-adapter-react-ui/styles.css";

export function WalletContextProvider({ children }: { children: ReactNode }) {
  const endpoint = import.meta.env.VITE_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

  // No explicit adapter list needed: modern wallets (Phantom, Solflare,
  // Backpack, ...) register themselves via the Wallet Standard and are
  // auto-detected by @solana/wallet-adapter-react. This avoids depending on
  // @solana/wallet-adapter-wallets, whose mobile adapter pulls in
  // react-native (and a conflicting React version) as a transitive dep.
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
