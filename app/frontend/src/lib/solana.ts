import { PublicKey } from "@solana/web3.js";

/** Must match declare_id!(...) in programs/escrow_marketplace/src/lib.rs
 * and app/backend/.env.example's MARKETPLACE_PROGRAM_ID. Override via
 * VITE_MARKETPLACE_PROGRAM_ID once you deploy your own instance. */
export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_MARKETPLACE_PROGRAM_ID ??
    "Byjh8A9Zir4PXUPUDJufmC6xoii5LN9W2omdt5D9LUuw"
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

/** Mirrors `seeds = [b"order_vault", listing, order_count_le_bytes]`. */
export function deriveOrderVaultPda(
  listing: PublicKey,
  orderId: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order_vault"), listing.toBuffer(), u64Le(orderId)],
    PROGRAM_ID
  );
}

export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1_000_000_000));
}
