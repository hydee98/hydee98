import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import type { EscrowMarketplace } from "../target/types/escrow_marketplace";

// Mirrors the on-chain enums in programs/escrow_marketplace/src/lib.rs
const ListingCategory = { property: { property: {} }, item: { item: {} } };
const ListingType = { forSale: { forSale: {} }, toLet: { toLet: {} } };
const FRAUD_AUTO_APPROVE_THRESHOLD = 60;

// 2% platform fee, matching FEE_BPS used at initialize_marketplace below.
const FEE_BPS = 200;
function expectedFee(amount: BN): BN {
  return amount.mul(new BN(FEE_BPS)).div(new BN(10_000));
}

describe("escrow_marketplace", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EscrowMarketplace as Program<EscrowMarketplace>;
  const authority = provider.wallet as anchor.Wallet;

  const seller = Keypair.generate();
  const buyer = Keypair.generate();
  const treasuryOwner = Keypair.generate();

  const [marketplacePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("marketplace")],
    program.programId
  );

  // 6-decimal USDC-style mint; $50.00 per listing.
  const USDC_DECIMALS = 6;
  const price = new BN(50).mul(new BN(10 ** USDC_DECIMALS));
  let usdcMint: PublicKey;
  let buyerUsdc: PublicKey;
  let sellerUsdc: PublicKey;
  let treasuryUsdc: PublicKey;

  function listingPda(listingCount: BN) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("listing"), seller.publicKey.toBuffer(), listingCount.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  }
  function orderPda(listing: PublicKey, orderCount: BN) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("order"), listing.toBuffer(), orderCount.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  }
  function vaultAuthorityPda(listing: PublicKey, orderCount: BN) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), listing.toBuffer(), orderCount.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  }

  async function usdcBalance(ata: PublicKey): Promise<BN> {
    const account = await getAccount(provider.connection, ata);
    return new BN(account.amount.toString());
  }

  before(async () => {
    for (const kp of [seller, buyer, treasuryOwner]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    // Stand in for USDC on localnet: a plain 6-decimal SPL mint the
    // marketplace is pinned to via initialize_marketplace's usdc_mint arg.
    usdcMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      USDC_DECIMALS
    );

    buyerUsdc = (
      await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer, usdcMint, buyer.publicKey)
    ).address;
    sellerUsdc = (
      await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer, usdcMint, seller.publicKey)
    ).address;
    treasuryUsdc = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        usdcMint,
        treasuryOwner.publicKey
      )
    ).address;

    // Fund the buyer with enough USDC to cover every order in this suite.
    await mintTo(
      provider.connection,
      authority.payer,
      usdcMint,
      buyerUsdc,
      authority.publicKey,
      price.toNumber() * 10
    );
  });

  it("initializes the marketplace with the USDC mint, treasury, and fee rate", async () => {
    await program.methods
      .initializeMarketplace(usdcMint, treasuryOwner.publicKey, FEE_BPS)
      .accounts({
        marketplace: marketplacePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const marketplace = await program.account.marketplace.fetch(marketplacePda);
    assert.equal(marketplace.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(marketplace.usdcMint.toBase58(), usdcMint.toBase58());
    assert.equal(marketplace.treasury.toBase58(), treasuryOwner.publicKey.toBase58());
    assert.equal(marketplace.feeBps, FEE_BPS);
    assert.equal(marketplace.listingCount.toNumber(), 0);
  });

  it("rejects a ToLet listing for an Item", async () => {
    const marketplaceBefore = await program.account.marketplace.fetch(marketplacePda);
    const listing = listingPda(marketplaceBefore.listingCount);
    let threw = false;
    try {
      await program.methods
        .createListing(ListingCategory.item, ListingType.toLet, "Used bicycle", "ipfs://bike", price)
        .accounts({
          marketplace: marketplacePda,
          listing,
          seller: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();
    } catch (err) {
      threw = true;
      assert.include(JSON.stringify(err), "InvalidListingType");
    }
    assert.isTrue(threw, "expected create_listing to reject Item + ToLet");
  });

  it("lists a property for sale, screens it as low-risk, and activates it", async () => {
    const marketplaceBefore = await program.account.marketplace.fetch(marketplacePda);
    const listingId = marketplaceBefore.listingCount;
    const listing = listingPda(listingId);

    await program.methods
      .createListing(
        ListingCategory.property,
        ListingType.forSale,
        "2-bed flat, Manchester",
        "ipfs://listing-1",
        price
      )
      .accounts({
        marketplace: marketplacePda,
        listing,
        seller: seller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    let listingAccount = await program.account.listing.fetch(listing);
    assert.deepEqual(listingAccount.status, { pendingReview: {} });

    await program.methods
      .reviewListing(20)
      .accounts({ marketplace: marketplacePda, listing, authority: authority.publicKey })
      .rpc();

    listingAccount = await program.account.listing.fetch(listing);
    assert.isBelow(listingAccount.aiFraudScore, FRAUD_AUTO_APPROVE_THRESHOLD + 1);
    assert.deepEqual(listingAccount.status, { active: {} });
  });

  it("funds an order in USDC, then the buyer confirms receipt: fee to treasury, remainder to seller", async () => {
    // The listing created in the previous test is listingId = 0 (the
    // rejected ToLet attempt never incremented marketplace.listingCount
    // because it failed before that point).
    const listingId = new BN(0);
    const listing = listingPda(listingId);
    const listingAccount = await program.account.listing.fetch(listing);
    const orderId = listingAccount.orderCount;
    const order = orderPda(listing, orderId);
    const vaultAuthority = vaultAuthorityPda(listing, orderId);
    const vaultTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        usdcMint,
        vaultAuthority,
        true // vaultAuthority is a PDA, not a wallet
      )
    ).address;

    const sellerBalanceBefore = await usdcBalance(sellerUsdc);
    const treasuryBalanceBefore = await usdcBalance(treasuryUsdc);

    await program.methods
      .createOrder(price)
      .accounts({
        marketplace: marketplacePda,
        listing,
        buyer: buyer.publicKey,
        usdcMint,
        order,
        vaultAuthority,
        vaultTokenAccount,
        buyerTokenAccount: buyerUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([buyer])
      .rpc();

    let listingAfterOrder = await program.account.listing.fetch(listing);
    assert.deepEqual(listingAfterOrder.status, { underOffer: {} });

    const vaultBalance = await usdcBalance(vaultTokenAccount);
    assert.isTrue(vaultBalance.eq(price), "vault should hold exactly the order amount");

    await program.methods
      .confirmReceipt()
      .accounts({
        marketplace: marketplacePda,
        listing,
        buyer: buyer.publicKey,
        order,
        usdcMint,
        vaultAuthority,
        vaultTokenAccount,
        seller: seller.publicKey,
        sellerTokenAccount: sellerUsdc,
        treasury: treasuryOwner.publicKey,
        treasuryTokenAccount: treasuryUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([buyer])
      .rpc();

    const orderAccount = await program.account.order.fetch(order);
    assert.deepEqual(orderAccount.status, { released: {} });

    const listingAfterSale = await program.account.listing.fetch(listing);
    assert.deepEqual(listingAfterSale.status, { sold: {} });

    const fee = expectedFee(price);
    const sellerNet = price.sub(fee);

    const sellerBalanceAfter = await usdcBalance(sellerUsdc);
    const treasuryBalanceAfter = await usdcBalance(treasuryUsdc);
    assert.isTrue(
      sellerBalanceAfter.sub(sellerBalanceBefore).eq(sellerNet),
      "seller should receive price minus the 2% platform fee"
    );
    assert.isTrue(
      treasuryBalanceAfter.sub(treasuryBalanceBefore).eq(fee),
      "treasury should receive exactly the 2% platform fee"
    );
  });

  it("flags a high-fraud-score listing instead of activating it", async () => {
    const marketplaceBefore = await program.account.marketplace.fetch(marketplacePda);
    const listingId = marketplaceBefore.listingCount;
    const listing = listingPda(listingId);

    await program.methods
      .createListing(
        ListingCategory.item,
        ListingType.forSale,
        "Brand new laptop, half price, wire transfer only",
        "ipfs://listing-suspicious",
        price
      )
      .accounts({
        marketplace: marketplacePda,
        listing,
        seller: seller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    await program.methods
      .reviewListing(85)
      .accounts({ marketplace: marketplacePda, listing, authority: authority.publicKey })
      .rpc();

    const listingAccount = await program.account.listing.fetch(listing);
    assert.isAbove(listingAccount.aiFraudScore, FRAUD_AUTO_APPROVE_THRESHOLD);
    assert.deepEqual(listingAccount.status, { flagged: {} });
  });

  it("opens a dispute and the arbitrator splits the escrow (fee applies only to the seller's share)", async () => {
    const marketplaceBefore = await program.account.marketplace.fetch(marketplacePda);
    const listingId = marketplaceBefore.listingCount;
    const listing = listingPda(listingId);

    await program.methods
      .createListing(ListingCategory.item, ListingType.forSale, "Vintage watch", "ipfs://listing-watch", price)
      .accounts({
        marketplace: marketplacePda,
        listing,
        seller: seller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();
    await program.methods
      .reviewListing(10)
      .accounts({ marketplace: marketplacePda, listing, authority: authority.publicKey })
      .rpc();

    const listingAccount = await program.account.listing.fetch(listing);
    const orderId = listingAccount.orderCount;
    const order = orderPda(listing, orderId);
    const vaultAuthority = vaultAuthorityPda(listing, orderId);
    const vaultTokenAccount = (
      await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer, usdcMint, vaultAuthority, true)
    ).address;

    await program.methods
      .createOrder(price)
      .accounts({
        marketplace: marketplacePda,
        listing,
        buyer: buyer.publicKey,
        usdcMint,
        order,
        vaultAuthority,
        vaultTokenAccount,
        buyerTokenAccount: buyerUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([buyer])
      .rpc();

    await program.methods
      .openDispute("ipfs://dispute-evidence-1")
      .accounts({ order, listing, signer: buyer.publicKey })
      .signers([buyer])
      .rpc();

    let orderAccount = await program.account.order.fetch(order);
    assert.deepEqual(orderAccount.status, { disputed: {} });

    const sellerBalanceBefore = await usdcBalance(sellerUsdc);
    const buyerBalanceBefore = await usdcBalance(buyerUsdc);
    const treasuryBalanceBefore = await usdcBalance(treasuryUsdc);

    const sellerBps = 5000; // 50/50 split
    await program.methods
      .resolveDispute({ split: { sellerBps } })
      .accounts({
        marketplace: marketplacePda,
        listing,
        authority: authority.publicKey,
        order,
        usdcMint,
        vaultAuthority,
        vaultTokenAccount,
        buyer: buyer.publicKey,
        buyerTokenAccount: buyerUsdc,
        seller: seller.publicKey,
        sellerTokenAccount: sellerUsdc,
        treasury: treasuryOwner.publicKey,
        treasuryTokenAccount: treasuryUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    orderAccount = await program.account.order.fetch(order);
    assert.deepEqual(orderAccount.status, { resolved: {} });

    const sellerGross = price.mul(new BN(sellerBps)).div(new BN(10_000));
    const buyerAmount = price.sub(sellerGross);
    const fee = expectedFee(sellerGross);
    const sellerNet = sellerGross.sub(fee);

    const sellerBalanceAfter = await usdcBalance(sellerUsdc);
    const buyerBalanceAfter = await usdcBalance(buyerUsdc);
    const treasuryBalanceAfter = await usdcBalance(treasuryUsdc);

    assert.isTrue(sellerBalanceAfter.sub(sellerBalanceBefore).eq(sellerNet), "seller gets their half minus the fee");
    assert.isTrue(buyerBalanceAfter.sub(buyerBalanceBefore).eq(buyerAmount), "buyer gets their half, fee-free");
    assert.isTrue(treasuryBalanceAfter.sub(treasuryBalanceBefore).eq(fee), "treasury gets the fee on the seller's share only");
  });

  it("lets either party cancel a funded order and refunds the buyer in full, with no fee", async () => {
    const marketplaceBefore = await program.account.marketplace.fetch(marketplacePda);
    const listingId = marketplaceBefore.listingCount;
    const listing = listingPda(listingId);

    await program.methods
      .createListing(ListingCategory.item, ListingType.forSale, "Garden shed", "ipfs://listing-shed", price)
      .accounts({
        marketplace: marketplacePda,
        listing,
        seller: seller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();
    await program.methods
      .reviewListing(15)
      .accounts({ marketplace: marketplacePda, listing, authority: authority.publicKey })
      .rpc();

    const listingAccount = await program.account.listing.fetch(listing);
    const orderId = listingAccount.orderCount;
    const order = orderPda(listing, orderId);
    const vaultAuthority = vaultAuthorityPda(listing, orderId);
    const vaultTokenAccount = (
      await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer, usdcMint, vaultAuthority, true)
    ).address;

    await program.methods
      .createOrder(price)
      .accounts({
        marketplace: marketplacePda,
        listing,
        buyer: buyer.publicKey,
        usdcMint,
        order,
        vaultAuthority,
        vaultTokenAccount,
        buyerTokenAccount: buyerUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([buyer])
      .rpc();

    const buyerBalanceBefore = await usdcBalance(buyerUsdc);

    await program.methods
      .cancelOrder()
      .accounts({
        marketplace: marketplacePda,
        listing,
        signer: seller.publicKey,
        order,
        usdcMint,
        vaultAuthority,
        vaultTokenAccount,
        buyer: buyer.publicKey,
        buyerTokenAccount: buyerUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([seller])
      .rpc();

    const orderAccount = await program.account.order.fetch(order);
    assert.deepEqual(orderAccount.status, { cancelled: {} });

    const listingAfterCancel = await program.account.listing.fetch(listing);
    assert.deepEqual(listingAfterCancel.status, { active: {} });

    const buyerBalanceAfter = await usdcBalance(buyerUsdc);
    assert.isTrue(buyerBalanceAfter.sub(buyerBalanceBefore).eq(price), "buyer should be refunded in full, no fee taken");
  });

  it("rejects review_listing from a non-authority signer", async () => {
    const marketplaceBefore = await program.account.marketplace.fetch(marketplacePda);
    const listingId = marketplaceBefore.listingCount;
    const listing = listingPda(listingId);

    await program.methods
      .createListing(ListingCategory.item, ListingType.forSale, "Old sofa", "ipfs://listing-sofa", price)
      .accounts({
        marketplace: marketplacePda,
        listing,
        seller: seller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    let threw = false;
    try {
      await program.methods
        .reviewListing(10)
        .accounts({ marketplace: marketplacePda, listing, authority: seller.publicKey })
        .signers([seller])
        .rpc();
    } catch (err) {
      threw = true;
      assert.include(JSON.stringify(err), "Unauthorized");
    }
    assert.isTrue(threw, "expected review_listing to reject a non-authority signer");
  });
});
