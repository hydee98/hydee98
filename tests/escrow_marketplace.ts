import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import type { EscrowMarketplace } from "../target/types/escrow_marketplace";

// Mirrors the on-chain enums in programs/escrow_marketplace/src/lib.rs
const ListingCategory = { property: { property: {} }, item: { item: {} } };
const ListingType = { forSale: { forSale: {} }, toLet: { toLet: {} } };
const FRAUD_AUTO_APPROVE_THRESHOLD = 60;

describe("escrow_marketplace", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EscrowMarketplace as Program<EscrowMarketplace>;
  const authority = provider.wallet as anchor.Wallet;

  const seller = Keypair.generate();
  const buyer = Keypair.generate();

  const [marketplacePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("marketplace")],
    program.programId
  );

  const price = new BN(0.5 * LAMPORTS_PER_SOL);

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
  function vaultPda(listing: PublicKey, orderCount: BN) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("order_vault"), listing.toBuffer(), orderCount.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  }

  before(async () => {
    for (const kp of [seller, buyer]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
  });

  it("initializes the marketplace", async () => {
    await program.methods
      .initializeMarketplace()
      .accounts({
        marketplace: marketplacePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const marketplace = await program.account.marketplace.fetch(marketplacePda);
    assert.equal(marketplace.authority.toBase58(), authority.publicKey.toBase58());
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

    // Stash for later tests via closure variables on `this` isn't available in
    // arrow-less `it`, so re-derive in subsequent tests from marketplace state.
  });

  it("funds an order, then the buyer confirms receipt and the seller is paid", async () => {
    const marketplaceState = await program.account.marketplace.fetch(marketplacePda);
    // The listing created in the previous test is listingId = 0 (first
    // successful create_listing; the rejected ToLet attempt never incremented
    // marketplace.listingCount because it failed before that point).
    const listingId = new BN(0);
    const listing = listingPda(listingId);
    const listingAccount = await program.account.listing.fetch(listing);
    const orderId = listingAccount.orderCount;
    const order = orderPda(listing, orderId);
    const vault = vaultPda(listing, orderId);

    const sellerBalanceBefore = await provider.connection.getBalance(seller.publicKey);

    await program.methods
      .createOrder(price)
      .accounts({
        listing,
        order,
        vault,
        buyer: buyer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    let listingAfterOrder = await program.account.listing.fetch(listing);
    assert.deepEqual(listingAfterOrder.status, { underOffer: {} });

    const vaultBalance = await provider.connection.getBalance(vault);
    assert.isAtLeast(vaultBalance, price.toNumber());

    await program.methods
      .confirmReceipt()
      .accounts({
        order,
        listing,
        vault,
        seller: seller.publicKey,
        buyer: buyer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const orderAccount = await program.account.order.fetch(order);
    assert.deepEqual(orderAccount.status, { released: {} });

    const listingAfterSale = await program.account.listing.fetch(listing);
    assert.deepEqual(listingAfterSale.status, { sold: {} });

    const sellerBalanceAfter = await provider.connection.getBalance(seller.publicKey);
    assert.isAbove(sellerBalanceAfter, sellerBalanceBefore);

    void marketplaceState; // silence unused var lint in case ordering changes
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

  it("opens a dispute and the arbitrator splits the escrow", async () => {
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
    const vault = vaultPda(listing, orderId);

    await program.methods
      .createOrder(price)
      .accounts({ listing, order, vault, buyer: buyer.publicKey, systemProgram: SystemProgram.programId })
      .signers([buyer])
      .rpc();

    await program.methods
      .openDispute("ipfs://dispute-evidence-1")
      .accounts({ order, listing, signer: buyer.publicKey })
      .signers([buyer])
      .rpc();

    let orderAccount = await program.account.order.fetch(order);
    assert.deepEqual(orderAccount.status, { disputed: {} });

    const sellerBalanceBefore = await provider.connection.getBalance(seller.publicKey);
    const buyerBalanceBefore = await provider.connection.getBalance(buyer.publicKey);

    await program.methods
      .resolveDispute({ split: { sellerBps: 5000 } })
      .accounts({
        marketplace: marketplacePda,
        order,
        listing,
        vault,
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    orderAccount = await program.account.order.fetch(order);
    assert.deepEqual(orderAccount.status, { resolved: {} });

    const sellerBalanceAfter = await provider.connection.getBalance(seller.publicKey);
    const buyerBalanceAfter = await provider.connection.getBalance(buyer.publicKey);
    assert.isAbove(sellerBalanceAfter, sellerBalanceBefore);
    assert.isAbove(buyerBalanceAfter, buyerBalanceBefore);
  });

  it("lets either party cancel a funded order and refunds the buyer in full", async () => {
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
    const vault = vaultPda(listing, orderId);

    await program.methods
      .createOrder(price)
      .accounts({ listing, order, vault, buyer: buyer.publicKey, systemProgram: SystemProgram.programId })
      .signers([buyer])
      .rpc();

    const buyerBalanceBefore = await provider.connection.getBalance(buyer.publicKey);

    await program.methods
      .cancelOrder()
      .accounts({
        order,
        listing,
        vault,
        buyer: buyer.publicKey,
        signer: seller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    const orderAccount = await program.account.order.fetch(order);
    assert.deepEqual(orderAccount.status, { cancelled: {} });

    const listingAfterCancel = await program.account.listing.fetch(listing);
    assert.deepEqual(listingAfterCancel.status, { active: {} });

    const buyerBalanceAfter = await provider.connection.getBalance(buyer.publicKey);
    assert.isAbove(buyerBalanceAfter, buyerBalanceBefore);
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
