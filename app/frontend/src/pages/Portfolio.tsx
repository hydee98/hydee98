import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { deriveAssociatedTokenAddress } from "../lib/solana";
import type { RwaAsset } from "../types";

interface Holding {
  asset: RwaAsset;
  shares: number;
}

export function Portfolio() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !publicKey) {
      setHoldings(null);
      return;
    }

    let cancelled = false;
    setError(null);
    setHoldings(null);

    (async () => {
      try {
        const { assets } = await api.listAssets();
        const mintedAssets = assets.filter((a) => a.mint);
        const results = await Promise.all(
          mintedAssets.map(async (asset) => {
            try {
              const ata = deriveAssociatedTokenAddress(
                publicKey,
                new PublicKey(asset.mint as string)
              );
              const balance = await connection.getTokenAccountBalance(ata);
              return { asset, shares: Number(balance.value.amount) };
            } catch {
              // No token account yet for this mint = zero shares held.
              return { asset, shares: 0 };
            }
          })
        );
        if (!cancelled) setHoldings(results.filter((h) => h.shares > 0));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load portfolio");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection]);

  if (!connected) {
    return (
      <div className="page">
        <h1>Portfolio</h1>
        <p>Connect your wallet to see the asset shares you hold.</p>
        <WalletMultiButton />
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Portfolio</h1>
      {error && <p className="error-banner">{error}</p>}
      {!holdings && !error && <p>Loading holdings…</p>}
      {holdings && holdings.length === 0 && (
        <p className="muted">
          No on-chain asset shares found for this wallet. (Demo assets in
          this deployment have no real mint yet - see the README.)
        </p>
      )}
      <ul className="holdings-list">
        {holdings?.map(({ asset, shares }) => (
          <li key={asset.id}>
            <Link to={`/asset/${asset.id}`}>{asset.name}</Link>
            <span>
              {shares.toLocaleString()} / {asset.totalShares.toLocaleString()} shares
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
