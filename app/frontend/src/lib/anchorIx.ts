import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { PROGRAM_ID, USDC_MINT, TREASURY_WALLET, deriveOrderPda, deriveVaultAuthorityPda } from "./solana";

/**
 * Hand-rolled Anchor instruction encoding for `create_order` and
 * `confirm_receipt` - the two instructions a connected wallet actually
 * signs in this dApp (buying, and releasing escrow on receipt), now
 * rewritten for the SPL/USDC escrow model in
 * programs/escrow_marketplace/src/lib.rs (see that file's module docs for
 * the full design).
 *
 * Escrow is always USDC. If the buyer chose to pay with something else
 * (SOL/USDT/SKR), swap it into USDC first in their own wallet - see
 * lib/jupiterSwap.ts - *before* building/sending the `create_order`
 * instruction below. This program and this dApp's backend never custody
 * a non-USDC balance.
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

/** The marketplace's single global config PDA - `seeds = [b"marketplace"]`. */
function deriveMarketplacePda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("marketplace")], PROGRAM_ID)[0];
}

export interface CreateOrderParams {
  listingPda: PublicKey;
  /** The listing's current `order_count` - used to derive this new
   * order's PDA/vault, and becomes the order's own `id`. */
  orderId: bigint;
  buyer: PublicKey;
  /** USDC base units (6 decimals) - must equal the listing's price_usdc
   * exactly. If the buyer paid with SOL/USDT/SKR, this is the USDC
   * amount they already swapped into, not their original currency. */
  amountUsdc: bigint;
}

/** Builds the `create_order(amount_usdc: u64)` instruction: the buyer
 * pays `amountUsdc` (already-USDC - see module docs) into a new per-order
 * escrow token account. Returns every instruction needed in order,
 * including creating the buyer's USDC ATA if it doesn't exist yet -
 * send them all in one transaction. */
export async function buildCreateOrderInstructions(
  params: CreateOrderParams
): Promise<TransactionInstruction[]> {
  const { listingPda, orderId, buyer, amountUsdc } = params;
  const marketplacePda = deriveMarketplacePda();
  const [orderPda] = deriveOrderPda(listingPda, orderId);
  const [vaultAuthority] = deriveVaultAuthorityPda(listingPda, orderId);

  const buyerUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, buyer, false);
  const vaultUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, vaultAuthority, true);

  const discriminator = await anchorDiscriminator("global", "create_order");
  const data = Buffer.concat([discriminator, u64LeBuffer(amountUsdc)]);

  const createOrderIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: marketplacePda, isSigner: false, isWritable: false },
      { pubkey: listingPda, isSigner: false, isWritable: true },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: vaultUsdcAta, isSigner: false, isWritable: true },
      { pubkey: buyerUsdcAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
  });

  // Anchor's `init` on vault_token_account creates it as part of this same
  // instruction, but the buyer's own USDC ATA is assumed to already exist
  // (they'd need USDC to have paid with it in the first place); creating
  // it idempotently first is a harmless no-op if it's already there and
  // avoids a hard failure for a first-time USDC holder.
  const ensureBuyerAta = createAssociatedTokenAccountIdempotentInstruction(
    buyer,
    buyerUsdcAta,
    buyer,
    USDC_MINT
  );

  return [ensureBuyerAta, createOrderIx];
}

export interface ConfirmReceiptParams {
  listingPda: PublicKey;
  orderId: bigint;
  seller: PublicKey;
  buyer: PublicKey;
}

/** Builds the `confirm_receipt()` instruction: the buyer confirms
 * delivery/handover. The vault's USDC splits automatically on-chain -
 * `fee_bps` to the treasury, the remainder to the seller. */
export async function buildConfirmReceiptInstructions(
  params: ConfirmReceiptParams
): Promise<TransactionInstruction[]> {
  const { listingPda, orderId, seller, buyer } = params;
  const marketplacePda = deriveMarketplacePda();
  const [orderPda] = deriveOrderPda(listingPda, orderId);
  const [vaultAuthority] = deriveVaultAuthorityPda(listingPda, orderId);

  const vaultUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, vaultAuthority, true);
  const sellerUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, seller, false);
  const treasuryUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, TREASURY_WALLET, false);

  const discriminator = await anchorDiscriminator("global", "confirm_receipt");

  return [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      data: discriminator,
      keys: [
        { pubkey: marketplacePda, isSigner: false, isWritable: false },
        { pubkey: listingPda, isSigner: false, isWritable: true },
        { pubkey: buyer, isSigner: true, isWritable: true },
        { pubkey: orderPda, isSigner: false, isWritable: true },
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: vaultAuthority, isSigner: false, isWritable: false },
        { pubkey: vaultUsdcAta, isSigner: false, isWritable: true },
        { pubkey: seller, isSigner: false, isWritable: false },
        { pubkey: sellerUsdcAta, isSigner: false, isWritable: true },
        { pubkey: TREASURY_WALLET, isSigner: false, isWritable: false },
        { pubkey: treasuryUsdcAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
    }),
  ];
}
