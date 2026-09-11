import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PROGRAM_ID, deriveOrderPda, deriveOrderVaultPda } from "./solana";

/**
 * Hand-rolled Anchor instruction encoding for `create_order` and
 * `confirm_receipt` - the two instructions a connected wallet actually
 * signs in this dApp (buying, and releasing escrow on receipt).
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
 * `Program<EscrowMarketplace>` built from
 * `target/idl/escrow_marketplace.json` - it gives you compile-time-checked
 * accounts/args instead of this manual encoding, and the encoder below can
 * be deleted.
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

export interface CreateOrderParams {
  listingPda: PublicKey;
  /** The listing's current `order_count` - used to derive this new
   * order's PDA/vault, and becomes the order's own `id`. */
  orderId: bigint;
  buyer: PublicKey;
  amountLamports: bigint;
}

/** Builds the `create_order(amount_lamports: u64)` instruction: the buyer
 * pays `amountLamports` into a new per-order escrow vault. */
export async function buildCreateOrderInstruction(
  params: CreateOrderParams
): Promise<TransactionInstruction> {
  const { listingPda, orderId, buyer, amountLamports } = params;
  const [orderPda] = deriveOrderPda(listingPda, orderId);
  const [vaultPda] = deriveOrderVaultPda(listingPda, orderId);

  const discriminator = await anchorDiscriminator("global", "create_order");
  const data = Buffer.concat([discriminator, u64LeBuffer(amountLamports)]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: listingPda, isSigner: false, isWritable: true },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export interface ConfirmReceiptParams {
  listingPda: PublicKey;
  orderId: bigint;
  seller: PublicKey;
  buyer: PublicKey;
}

/** Builds the `confirm_receipt()` instruction: the buyer confirms
 * delivery/handover, releasing the full escrowed amount to the seller. */
export async function buildConfirmReceiptInstruction(
  params: ConfirmReceiptParams
): Promise<TransactionInstruction> {
  const { listingPda, orderId, seller, buyer } = params;
  const [orderPda] = deriveOrderPda(listingPda, orderId);
  const [vaultPda] = deriveOrderVaultPda(listingPda, orderId);

  const discriminator = await anchorDiscriminator("global", "confirm_receipt");

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: discriminator,
    keys: [
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: listingPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: true },
      { pubkey: buyer, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}
