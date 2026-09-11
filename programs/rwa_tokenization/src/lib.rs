//! RWA Tokenization Program
//!
//! Anchor program that tokenizes real-world assets (real estate, invoices,
//! commodities, ...) into fractional SPL-token shares. Off-chain, an AI
//! service (see `app/backend`) produces a risk score and due-diligence
//! report for each asset; the platform authority attests that score
//! on-chain via `approve_asset`, which gates whether an asset can be
//! offered to investors. This program does not call the AI itself -
//! Solana programs cannot make outbound HTTP calls - it only stores and
//! enforces the outcome of that off-chain assessment.
//!
//! Flow:
//!   1. `initialize_registry`      - platform authority sets up global state
//!   2. `register_asset`          - an originator lists a new asset (PendingReview)
//!   3. `set_kyc_status`          - authority allow-lists an investor
//!   4. `approve_asset`           - authority publishes the AI risk score, asset goes Active/Rejected
//!   5. `invest`                  - a KYC'd investor buys fractional shares (SOL -> vault, shares minted)
//!   6. `withdraw_funds`          - the originator withdraws raised SOL from the vault
//!   7. `freeze_asset`            - authority can freeze an asset at any time (compliance/emergency)

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

declare_id!("96fhowjcVma9sKzQuiStDvXZsPDc9GnafKfSAwdTkyCP");

/// Risk scores (0-100, higher = riskier) at or below this threshold are
/// auto-eligible for Active status when the authority calls `approve_asset`.
/// Scores above the threshold are recorded but the asset is marked Rejected
/// until a human reviews it further off-chain.
pub const AUTO_APPROVE_RISK_THRESHOLD: u8 = 70;

pub const MAX_NAME_LEN: usize = 64;
pub const MAX_URI_LEN: usize = 200;

#[program]
pub mod rwa_tokenization {
    use super::*;

    /// One-time setup of the global registry. `authority` is the platform
    /// operator that can KYC-approve investors, publish AI risk scores, and
    /// freeze assets.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.asset_count = 0;
        registry.bump = ctx.bumps.registry;
        Ok(())
    }

    /// List a new real-world asset for fractional tokenization. Creates a
    /// zero-decimal SPL mint (one token = one share) whose mint authority is
    /// the asset PDA itself, so only this program can ever mint shares.
    pub fn register_asset(
        ctx: Context<RegisterAsset>,
        asset_type: AssetType,
        name: String,
        uri: String,
        valuation_usd: u64,
        total_shares: u64,
        price_per_share_lamports: u64,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, RwaError::NameTooLong);
        require!(uri.len() <= MAX_URI_LEN, RwaError::UriTooLong);
        require!(total_shares > 0, RwaError::InvalidShareCount);
        require!(price_per_share_lamports > 0, RwaError::InvalidPrice);

        let registry = &mut ctx.accounts.registry;
        let asset = &mut ctx.accounts.asset;

        asset.id = registry.asset_count;
        asset.originator = ctx.accounts.originator.key();
        asset.asset_type = asset_type;
        asset.name = name;
        asset.uri = uri;
        asset.valuation_usd = valuation_usd;
        asset.total_shares = total_shares;
        asset.shares_sold = 0;
        asset.price_per_share_lamports = price_per_share_lamports;
        asset.status = AssetStatus::PendingReview;
        asset.ai_risk_score = 0;
        asset.mint = ctx.accounts.mint.key();
        asset.created_at = Clock::get()?.unix_timestamp;
        asset.bump = ctx.bumps.asset;
        asset.vault_bump = ctx.bumps.vault;

        registry.asset_count = registry
            .asset_count
            .checked_add(1)
            .ok_or(RwaError::MathOverflow)?;

        Ok(())
    }

    /// Authority-only: allow-list (or revoke) an investor after off-chain
    /// KYC/AML checks. `invest` refuses to run for a non-approved investor.
    pub fn set_kyc_status(
        ctx: Context<SetKycStatus>,
        investor: Pubkey,
        approved: bool,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.registry.authority,
            ctx.accounts.authority.key(),
            RwaError::Unauthorized
        );

        let kyc = &mut ctx.accounts.kyc_record;
        kyc.investor = investor;
        kyc.approved = approved;
        kyc.updated_at = Clock::get()?.unix_timestamp;
        kyc.bump = ctx.bumps.kyc_record;
        Ok(())
    }

    /// Authority-only: publish the AI-generated risk score for a pending
    /// asset. Scores at/under `AUTO_APPROVE_RISK_THRESHOLD` open the asset
    /// to investment; higher scores mark it Rejected pending further
    /// off-chain review. The score itself is produced off-chain by the
    /// backend's AI service and relayed here by the authority.
    pub fn approve_asset(ctx: Context<UpdateAsset>, ai_risk_score: u8) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.registry.authority,
            ctx.accounts.authority.key(),
            RwaError::Unauthorized
        );
        require!(ai_risk_score <= 100, RwaError::InvalidRiskScore);

        let asset = &mut ctx.accounts.asset;
        require!(
            asset.status == AssetStatus::PendingReview,
            RwaError::InvalidAssetStatus
        );

        asset.ai_risk_score = ai_risk_score;
        asset.status = if ai_risk_score <= AUTO_APPROVE_RISK_THRESHOLD {
            AssetStatus::Active
        } else {
            AssetStatus::Rejected
        };
        Ok(())
    }

    /// Authority-only: freeze an active asset at any time (compliance hold,
    /// dispute, revised risk assessment, ...). Frozen assets cannot receive
    /// new investment.
    pub fn freeze_asset(ctx: Context<UpdateAsset>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.registry.authority,
            ctx.accounts.authority.key(),
            RwaError::Unauthorized
        );
        let asset = &mut ctx.accounts.asset;
        require!(
            asset.status == AssetStatus::Active,
            RwaError::InvalidAssetStatus
        );
        asset.status = AssetStatus::Frozen;
        Ok(())
    }

    /// KYC'd investor buys `shares_amount` fractional shares of an Active
    /// asset. Lamports flow investor -> asset vault PDA; shares are minted
    /// 1:1 to the investor's associated token account.
    pub fn invest(ctx: Context<Invest>, shares_amount: u64) -> Result<()> {
        require!(
            ctx.accounts.kyc_record.investor == ctx.accounts.investor.key()
                && ctx.accounts.kyc_record.approved,
            RwaError::InvestorNotApproved
        );

        let asset = &mut ctx.accounts.asset;
        require!(
            asset.status == AssetStatus::Active,
            RwaError::InvalidAssetStatus
        );
        require!(shares_amount > 0, RwaError::InvalidShareCount);

        let remaining = asset
            .total_shares
            .checked_sub(asset.shares_sold)
            .ok_or(RwaError::MathOverflow)?;
        require!(
            shares_amount <= remaining,
            RwaError::NotEnoughSharesAvailable
        );

        let cost_lamports = asset
            .price_per_share_lamports
            .checked_mul(shares_amount)
            .ok_or(RwaError::MathOverflow)?;

        // Move payment into the asset's SOL vault.
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.investor.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
        system_program::transfer(cpi_ctx, cost_lamports)?;

        // Mint the purchased shares to the investor, signed by the asset PDA.
        let asset_id_bytes = asset.id.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[
            b"asset",
            asset.originator.as_ref(),
            &asset_id_bytes,
            &[asset.bump],
        ];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.investor_shares_account.to_account_info(),
            authority: asset.to_account_info(),
        };
        let signer_seeds_list = [signer_seeds];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &signer_seeds_list,
        );
        token::mint_to(cpi_ctx, shares_amount)?;

        asset.shares_sold = asset
            .shares_sold
            .checked_add(shares_amount)
            .ok_or(RwaError::MathOverflow)?;
        if asset.shares_sold == asset.total_shares {
            asset.status = AssetStatus::FullyFunded;
        }

        Ok(())
    }

    /// Originator-only: withdraw raised SOL from the asset's vault.
    pub fn withdraw_funds(ctx: Context<WithdrawFunds>, amount: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.asset.originator,
            ctx.accounts.originator.key(),
            RwaError::Unauthorized
        );

        let asset_id_bytes = ctx.accounts.asset.id.to_le_bytes();
        let originator_key = ctx.accounts.asset.originator;
        let vault_bump = ctx.accounts.asset.vault_bump;
        let signer_seeds: &[&[u8]] = &[
            b"vault",
            originator_key.as_ref(),
            &asset_id_bytes,
            &[vault_bump],
        ];

        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.originator.to_account_info(),
        };
        let signer_seeds_list = [signer_seeds];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
            &signer_seeds_list,
        );
        system_program::transfer(cpi_ctx, amount)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Registry::INIT_SPACE,
        seeds = [b"registry"],
        bump
    )]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(asset_type: AssetType, name: String, uri: String)]
pub struct RegisterAsset<'info> {
    #[account(mut, seeds = [b"registry"], bump = registry.bump)]
    pub registry: Account<'info, Registry>,

    #[account(
        init,
        payer = originator,
        space = 8 + Asset::INIT_SPACE,
        seeds = [b"asset", originator.key().as_ref(), &registry.asset_count.to_le_bytes()],
        bump
    )]
    pub asset: Account<'info, Asset>,

    /// SOL vault that escrows investor payments for this asset. Plain
    /// system-owned PDA - no account data, exists only to hold lamports and
    /// be a signer for `withdraw_funds`.
    /// CHECK: address is fully derived from seeds; no data is read from it.
    #[account(
        mut,
        seeds = [b"vault", originator.key().as_ref(), &registry.asset_count.to_le_bytes()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        init,
        payer = originator,
        mint::decimals = 0,
        mint::authority = asset,
        mint::freeze_authority = asset,
    )]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub originator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(investor: Pubkey)]
pub struct SetKycStatus<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump)]
    pub registry: Account<'info, Registry>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + KycRecord::INIT_SPACE,
        seeds = [b"kyc", investor.as_ref()],
        bump
    )]
    pub kyc_record: Account<'info, KycRecord>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAsset<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump)]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub asset: Account<'info, Asset>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Invest<'info> {
    #[account(mut)]
    pub asset: Account<'info, Asset>,

    #[account(
        mut,
        seeds = [b"vault", asset.originator.as_ref(), &asset.id.to_le_bytes()],
        bump = asset.vault_bump
    )]
    /// CHECK: address is fully derived from seeds; no data is read from it.
    pub vault: AccountInfo<'info>,

    #[account(
        seeds = [b"kyc", investor.key().as_ref()],
        bump = kyc_record.bump
    )]
    pub kyc_record: Account<'info, KycRecord>,

    #[account(mut, address = asset.mint)]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = investor,
        associated_token::mint = mint,
        associated_token::authority = investor,
    )]
    pub investor_shares_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub investor: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct WithdrawFunds<'info> {
    pub asset: Account<'info, Asset>,

    #[account(
        mut,
        seeds = [b"vault", asset.originator.as_ref(), &asset.id.to_le_bytes()],
        bump = asset.vault_bump
    )]
    /// CHECK: address is fully derived from seeds; no data is read from it.
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub originator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub authority: Pubkey,
    pub asset_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Asset {
    pub id: u64,
    pub originator: Pubkey,
    pub asset_type: AssetType,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    /// Off-chain metadata URI (e.g. IPFS/Arweave) pointing to the asset's
    /// legal documents, appraisal, and the AI due-diligence report used to
    /// derive `ai_risk_score`.
    #[max_len(MAX_URI_LEN)]
    pub uri: String,
    pub valuation_usd: u64,
    pub total_shares: u64,
    pub shares_sold: u64,
    pub price_per_share_lamports: u64,
    pub status: AssetStatus,
    /// 0-100, higher = riskier. Set once by `approve_asset`.
    pub ai_risk_score: u8,
    pub mint: Pubkey,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct KycRecord {
    pub investor: Pubkey,
    pub approved: bool,
    pub updated_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AssetType {
    RealEstate,
    Invoice,
    Commodity,
    PrivateCredit,
    Other,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AssetStatus {
    PendingReview,
    Active,
    FullyFunded,
    Frozen,
    Rejected,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum RwaError {
    #[msg("Asset name exceeds max length")]
    NameTooLong,
    #[msg("Metadata URI exceeds max length")]
    UriTooLong,
    #[msg("Total shares must be greater than zero")]
    InvalidShareCount,
    #[msg("Price per share must be greater than zero")]
    InvalidPrice,
    #[msg("Risk score must be between 0 and 100")]
    InvalidRiskScore,
    #[msg("Asset is not in the required status for this action")]
    InvalidAssetStatus,
    #[msg("Investor has not been KYC-approved")]
    InvestorNotApproved,
    #[msg("Not enough shares available for this purchase")]
    NotEnoughSharesAvailable,
    #[msg("Signer is not authorized to perform this action")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
