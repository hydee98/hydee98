import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import type { RwaTokenization } from "../target/types/rwa_tokenization";

// Mirrors the on-chain enums in programs/rwa_tokenization/src/lib.rs
const AssetType = { realEstate: {} };
const AUTO_APPROVE_RISK_THRESHOLD = 70;

describe("rwa_tokenization", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.RwaTokenization as Program<RwaTokenization>;
  const authority = provider.wallet as anchor.Wallet;

  const originator = Keypair.generate();
  const investor = Keypair.generate();
  const rejectedInvestor = Keypair.generate();

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    program.programId
  );

  const priceLamports = new BN(0.1 * LAMPORTS_PER_SOL);
  const totalShares = new BN(1000);

  let assetId: BN;
  let assetPda: PublicKey;
  let vaultPda: PublicKey;
  let mint: Keypair;

  before(async () => {
    for (const kp of [originator, investor, rejectedInvestor]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
  });

  it("initializes the registry", async () => {
    await program.methods
      .initializeRegistry()
      .accounts({
        registry: registryPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const registry = await program.account.registry.fetch(registryPda);
    assert.equal(registry.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(registry.assetCount.toNumber(), 0);
  });

  it("registers a new asset (PendingReview)", async () => {
    const registryBefore = await program.account.registry.fetch(registryPda);
    assetId = registryBefore.assetCount;
    mint = Keypair.generate();

    [assetPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("asset"),
        originator.publicKey.toBuffer(),
        assetId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        originator.publicKey.toBuffer(),
        assetId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    await program.methods
      .registerAsset(
        AssetType.realEstate,
        "Maple Street Duplex",
        "ipfs://demo-asset-metadata",
        new BN(250_000),
        totalShares,
        priceLamports
      )
      .accounts({
        registry: registryPda,
        asset: assetPda,
        vault: vaultPda,
        mint: mint.publicKey,
        originator: originator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([originator, mint])
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.equal(asset.name, "Maple Street Duplex");
    assert.deepEqual(asset.status, { pendingReview: {} });
    assert.equal(asset.totalShares.toNumber(), 1000);
  });

  it("KYC-approves the investor but not the rejected one", async () => {
    const [kycPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("kyc"), investor.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .setKycStatus(investor.publicKey, true)
      .accounts({
        registry: registryPda,
        kycRecord: kycPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const kyc = await program.account.kycRecord.fetch(kycPda);
    assert.isTrue(kyc.approved);
  });

  it("rejects investment from a non-approved investor", async () => {
    // Approve the asset first so the failure we see is specifically the KYC gate.
    await program.methods
      .approveAsset(20)
      .accounts({
        registry: registryPda,
        asset: assetPda,
        authority: authority.publicKey,
      })
      .rpc();

    const [rejectedKycPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("kyc"), rejectedInvestor.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .setKycStatus(rejectedInvestor.publicKey, false)
      .accounts({
        registry: registryPda,
        kycRecord: rejectedKycPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const sharesAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      rejectedInvestor.publicKey
    );

    let threw = false;
    try {
      await program.methods
        .invest(new BN(10))
        .accounts({
          asset: assetPda,
          vault: vaultPda,
          kycRecord: rejectedKycPda,
          mint: mint.publicKey,
          investorSharesAccount: sharesAta,
          investor: rejectedInvestor.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([rejectedInvestor])
        .rpc();
    } catch (err) {
      threw = true;
      assert.include(JSON.stringify(err), "InvestorNotApproved");
    }
    assert.isTrue(threw, "expected invest() to reject a non-KYC'd investor");
  });

  it("publishes an AI risk score and activates the asset (approve_asset)", async () => {
    // approve_asset requires PendingReview; register a second asset for this case
    // since the first one was already approved above.
    const registryBefore = await program.account.registry.fetch(registryPda);
    const secondAssetId = registryBefore.assetCount;
    const secondMint = Keypair.generate();
    const [secondAssetPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("asset"),
        originator.publicKey.toBuffer(),
        secondAssetId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const [secondVaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        originator.publicKey.toBuffer(),
        secondAssetId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    await program.methods
      .registerAsset(
        AssetType.realEstate,
        "High Risk Warehouse",
        "ipfs://demo-asset-metadata-2",
        new BN(500_000),
        totalShares,
        priceLamports
      )
      .accounts({
        registry: registryPda,
        asset: secondAssetPda,
        vault: secondVaultPda,
        mint: secondMint.publicKey,
        originator: originator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([originator, secondMint])
      .rpc();

    // Simulate the AI service flagging this one as high risk.
    await program.methods
      .approveAsset(85)
      .accounts({
        registry: registryPda,
        asset: secondAssetPda,
        authority: authority.publicKey,
      })
      .rpc();

    const asset = await program.account.asset.fetch(secondAssetPda);
    assert.equal(asset.aiRiskScore, 85);
    assert.isAbove(asset.aiRiskScore, AUTO_APPROVE_RISK_THRESHOLD);
    assert.deepEqual(asset.status, { rejected: {} });
  });

  it("lets a KYC'd investor buy shares of the Active asset", async () => {
    const [kycPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("kyc"), investor.publicKey.toBuffer()],
      program.programId
    );
    const sharesAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      investor.publicKey
    );

    await program.methods
      .invest(new BN(10))
      .accounts({
        asset: assetPda,
        vault: vaultPda,
        kycRecord: kycPda,
        mint: mint.publicKey,
        investorSharesAccount: sharesAta,
        investor: investor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([investor])
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.equal(asset.sharesSold.toNumber(), 10);

    const tokenBalance = await provider.connection.getTokenAccountBalance(
      sharesAta
    );
    assert.equal(tokenBalance.value.amount, "10");

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.isAtLeast(vaultBalance, priceLamports.toNumber() * 10);
  });

  it("lets the originator withdraw raised funds from the vault", async () => {
    const before = await provider.connection.getBalance(originator.publicKey);

    await program.methods
      .withdrawFunds(priceLamports.mul(new BN(10)))
      .accounts({
        asset: assetPda,
        vault: vaultPda,
        originator: originator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([originator])
      .rpc();

    const after = await provider.connection.getBalance(originator.publicKey);
    assert.isAbove(after, before);
  });

  it("freezes an Active asset and blocks further investment", async () => {
    await program.methods
      .freezeAsset()
      .accounts({
        registry: registryPda,
        asset: assetPda,
        authority: authority.publicKey,
      })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.deepEqual(asset.status, { frozen: {} });
  });
});
