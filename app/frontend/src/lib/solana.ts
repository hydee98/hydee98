import { PublicKey } from "@solana/web3.js";

/** Must match declare_id!(...) in programs/rwa_tokenization/src/lib.rs and
 * app/backend/.env.example's RWA_PROGRAM_ID. Override via VITE_RWA_PROGRAM_ID
 * once you deploy your own instance. */
export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_RWA_PROGRAM_ID ??
    "96fhowjcVma9sKzQuiStDvXZsPDc9GnafKfSAwdTkyCP"
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

function u64Le(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/** Mirrors `seeds = [b"registry"]`. */
export function deriveRegistryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("registry")], PROGRAM_ID);
}

/** Mirrors `seeds = [b"asset", originator, asset_id_le_bytes]`. */
export function deriveAssetPda(
  originator: PublicKey,
  assetId: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), originator.toBuffer(), u64Le(assetId)],
    PROGRAM_ID
  );
}

/** Mirrors `seeds = [b"vault", originator, asset_id_le_bytes]`. */
export function deriveVaultPda(
  originator: PublicKey,
  assetId: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), originator.toBuffer(), u64Le(assetId)],
    PROGRAM_ID
  );
}

/** Mirrors `seeds = [b"kyc", investor]`. */
export function deriveKycPda(investor: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("kyc"), investor.toBuffer()],
    PROGRAM_ID
  );
}

/** Mirrors the SPL Associated Token Account address derivation. */
export function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1_000_000_000));
}
