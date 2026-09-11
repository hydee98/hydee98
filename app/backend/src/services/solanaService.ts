import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Thin read-side integration with the on-chain `escrow_marketplace` Anchor
 * program (see /programs/escrow_marketplace). This module intentionally
 * does NOT depend on the generated Anchor IDL/client so the backend can
 * build and run before the program has ever been deployed (this sandbox
 * has no Solana CLI/Anchor CLI available - see the root README). Once you
 * run `anchor build` and deploy, swap `fetchClusterStatus`'s manual RPC
 * calls for a typed `@coral-xyz/anchor` `Program<EscrowMarketplace>` client
 * built from `target/idl/escrow_marketplace.json`, and use it to decode
 * `Listing` / `Order` / `Marketplace` accounts directly instead of the
 * in-memory demo stores in `data/listings.ts` / `data/orders.ts`.
 */

const PROGRAM_ID = new PublicKey(
  process.env.MARKETPLACE_PROGRAM_ID || "Byjh8A9Zir4PXUPUDJufmC6xoii5LN9W2omdt5D9LUuw"
);

let connection: Connection | null = null;
export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
      "confirmed"
    );
  }
  return connection;
}

export function getProgramId(): PublicKey {
  return PROGRAM_ID;
}

/** Mirrors `seeds = [b"marketplace"]` in lib.rs. */
export function deriveMarketplacePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("marketplace")], PROGRAM_ID);
}

/** Mirrors `seeds = [b"listing", seller, listing_count_le_bytes]` in lib.rs. */
export function deriveListingPda(
  seller: PublicKey,
  listingId: bigint
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(listingId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), seller.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

/** Mirrors `seeds = [b"order", listing, order_count_le_bytes]` in lib.rs. */
export function deriveOrderPda(
  listing: PublicKey,
  orderId: bigint
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), listing.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

/** Mirrors `seeds = [b"order_vault", listing, order_count_le_bytes]` in lib.rs. */
export function deriveOrderVaultPda(
  listing: PublicKey,
  orderId: bigint
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order_vault"), listing.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

export interface ClusterStatus {
  rpcUrl: string;
  programId: string;
  slot: number | null;
  programDeployed: boolean;
  error?: string;
}

/** Lightweight connectivity/health check used by GET /api/health. Never
 * throws - a down RPC or undeployed program degrades gracefully so the rest
 * of the (off-chain-backed) app keeps working. */
export async function fetchClusterStatus(): Promise<ClusterStatus> {
  const conn = getConnection();
  const base = {
    rpcUrl: conn.rpcEndpoint,
    programId: PROGRAM_ID.toBase58(),
  };
  try {
    const [slot, programInfo] = await Promise.all([
      conn.getSlot(),
      conn.getAccountInfo(PROGRAM_ID),
    ]);
    return { ...base, slot, programDeployed: programInfo !== null };
  } catch (err) {
    return {
      ...base,
      slot: null,
      programDeployed: false,
      error: err instanceof Error ? err.message : "Unknown RPC error",
    };
  }
}
