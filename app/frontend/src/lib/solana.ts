import { PublicKey } from "@solana/web3.js";

/** Must match declare_id!(...) in programs/escrow_marketplace/src/lib.rs
 * and app/backend/.env.example's MARKETPLACE_PROGRAM_ID. Override via
 * VITE_MARKETPLACE_PROGRAM_ID once you deploy your own instance. */
export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_MARKETPLACE_PROGRAM_ID ??
    "Byjh8A9Zir4PXUPUDJufmC6xoii5LN9W2omdt5D9LUuw"
);

/** The single stablecoin mint this deployment escrows - must match the
 * `usdc_mint` passed to `initialize_marketplace`. Defaults to devnet
 * USDC; override via VITE_USDC_MINT for mainnet or a custom test mint. */
export const USDC_MINT = new PublicKey(
  import.meta.env.VITE_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

/** Wallet that receives the 2% platform fee on completed sales - funds
 * buyback and reward distribution for the platform token. Must match the
 * `treasury` passed to `initialize_marketplace`/`set_fee_config`. The
 * default below is a placeholder keypair generated for this repo (its
 * private key was discarded) - override via VITE_TREASURY_WALLET with
 * your real treasury address before going live. */
export const TREASURY_WALLET = new PublicKey(
  import.meta.env.VITE_TREASURY_WALLET ?? "FiCbFyfCHLCia1odL53qjTFGuPyNYMgppVRmXZC6aNod"
);

function u64Le(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/** Mirrors `seeds = [b"marketplace"]`. */
export function deriveMarketplacePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("marketplace")], PROGRAM_ID);
}

/** Mirrors `seeds = [b"listing", seller, listing_count_le_bytes]`. */
export function deriveListingPda(
  seller: PublicKey,
  listingId: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), seller.toBuffer(), u64Le(listingId)],
    PROGRAM_ID
  );
}

/** Mirrors `seeds = [b"order", listing, order_count_le_bytes]`. */
export function deriveOrderPda(
  listing: PublicKey,
  orderId: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), listing.toBuffer(), u64Le(orderId)],
    PROGRAM_ID
  );
}

/** Mirrors `seeds = [b"vault_authority", listing, order_count_le_bytes]` -
 * the PDA that signs outgoing transfers from an order's escrow token
 * account (which is itself just a regular associated token account owned
 * by this PDA, derived via getAssociatedTokenAddressSync). */
export function deriveVaultAuthorityPda(
  listing: PublicKey,
  orderId: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), listing.toBuffer(), u64Le(orderId)],
    PROGRAM_ID
  );
}

/** USDC uses 6 decimals - this converts a human USD amount into the base
 * units `price_usdc`/`amount_usdc` expect on-chain. */
export function usdToUsdcBaseUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

export function usdcBaseUnitsToUsd(baseUnits: bigint | number): number {
  return Number(baseUnits) / 1_000_000;
}
