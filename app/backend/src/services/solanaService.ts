import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Thin read-side integration with the on-chain `rwa_tokenization` Anchor
 * program (see /programs/rwa_tokenization). This module intentionally does
 * NOT depend on the generated Anchor IDL/client so the backend can build and
 * run before the program has ever been deployed (this sandbox has no Solana
 * CLI/Anchor CLI available - see the root README). Once you run
 * `anchor build` and deploy, swap `fetchClusterStatus`'s manual RPC calls
 * for a typed `@coral-xyz/anchor` `Program<RwaTokenization>` client built
 * from `target/idl/rwa_tokenization.json`, and use it to decode `Asset` /
 * `Registry` / `KycRecord` accounts directly instead of the in-memory demo
 * store in `data/assets.ts`.
 */

const PROGRAM_ID = new PublicKey(
  process.env.RWA_PROGRAM_ID || "96fhowjcVma9sKzQuiStDvXZsPDc9GnafKfSAwdTkyCP"
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

/** Mirrors `seeds = [b"registry"]` in lib.rs. */
export function deriveRegistryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("registry")], PROGRAM_ID);
}

/** Mirrors `seeds = [b"asset", originator, asset_id_le_bytes]` in lib.rs. */
export function deriveAssetPda(
  originator: PublicKey,
  assetId: bigint
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(assetId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), originator.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

/** Mirrors `seeds = [b"vault", originator, asset_id_le_bytes]` in lib.rs. */
export function deriveVaultPda(
  originator: PublicKey,
  assetId: bigint
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(assetId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), originator.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

/** Mirrors `seeds = [b"kyc", investor]` in lib.rs. */
export function deriveKycPda(investor: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("kyc"), investor.toBuffer()],
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
