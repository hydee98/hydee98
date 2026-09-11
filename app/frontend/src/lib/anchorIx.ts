import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  deriveAssociatedTokenAddress,
  deriveKycPda,
  deriveVaultPda,
} from "./solana";

/**
 * Hand-rolled Anchor instruction encoding for the `invest` instruction.
 *
 * Why not the `@coral-xyz/anchor` `Program` client? That needs the IDL
 * produced by `anchor build`, which requires the Solana/Anchor CLI - not
 * available in every environment (including the one this scaffold was
 * built in). The wire format is simple and stable, so we encode it
 * directly instead:
 *
 *   instruction data = sha256("global:<snake_case_ix_name>")[0..8]  (the
 *   "Anchor discriminator") followed by the Borsh-serialized args, in the
 *   exact order declared in the Rust `#[program]` function signature.
 *
 * Once you run `anchor build`, prefer swapping this for a typed
 * `Program<RwaTokenization>` built from `target/idl/rwa_tokenization.json`
 * - it gives you compile-time-checked accounts/args instead of this manual
 * encoding. This module exists so the dApp has a real, working on-chain
 * write path before that IDL exists.
 */

async function anchorDiscriminator(namespace: "global", name: string): Promise<Buffer> {
  const preimage = `${namespace}:${name}`;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(preimage));
  return Buffer.from(hash).subarray(0, 8);
}

function u64LeBuffer(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

export interface InvestParams {
  /** The asset originator's wallet - part of the asset/vault PDA seeds. */
  originator: PublicKey;
  /** The asset's on-chain id (`Asset.id`, i.e. `registry.asset_count` at
   * the time it was registered). */
  assetId: bigint;
  assetPda: PublicKey;
  mint: PublicKey;
  investor: PublicKey;
  sharesAmount: bigint;
}

/** Builds the `invest(shares_amount: u64)` instruction. The investor pays
 * `shares_amount * price_per_share_lamports` (read on-chain from the asset
 * account by the program) into the asset's SOL vault and receives
 * `shares_amount` share tokens, minting the investor's associated token
 * account on the fly if it doesn't exist yet. */
export async function buildInvestInstruction(
  params: InvestParams
): Promise<TransactionInstruction> {
  const { originator, assetId, assetPda, mint, investor, sharesAmount } = params;

  const [vaultPda] = deriveVaultPda(originator, assetId);
  const [kycPda] = deriveKycPda(investor);
  const investorSharesAccount = deriveAssociatedTokenAddress(investor, mint);

  const discriminator = await anchorDiscriminator("global", "invest");
  const data = Buffer.concat([discriminator, u64LeBuffer(sharesAmount)]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: assetPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: kycPda, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: investorSharesAccount, isSigner: false, isWritable: true },
      { pubkey: investor, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
  });
}
