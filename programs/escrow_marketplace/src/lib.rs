//! Escrow Marketplace Program
//!
//! A peer-to-peer marketplace for property (for sale or to let) and general
//! items - the eBay/Zoopla model - paid for in SOL, with the payment held
//! in an on-chain escrow vault until the buyer confirms receipt/handover.
//! An off-chain AI service (see `app/backend`) screens new listings for
//! fraud/scam signals; the platform authority publishes that score
//! on-chain via `review_listing`, which gates whether a listing opens for
//! purchase. Solana programs can't make outbound HTTP calls, so - as with
//! any oracle-style integration - the AI step itself happens off-chain and
//! only its result is attested here.
//!
//! Flow:
//!   1. `initialize_marketplace` - platform authority sets up global state
//!   2. `create_listing`        - a seller lists a property or item (PendingReview)
//!   3. `review_listing`        - authority publishes the AI fraud score, listing goes Active/Flagged
//!   4. `remove_listing`        - authority can pull a listing at any time (compliance)
//!   5. `create_order`          - a buyer pays the listing price into escrow (Buy-It-Now, no offers)
//!   6. `confirm_receipt`       - buyer confirms delivery/handover, funds release to the seller
//!   7. `cancel_order`          - buyer or seller calls off an unreleased order, buyer is refunded
//!   8. `open_dispute`          - buyer or seller flags a problem before receipt is confirmed
//!   9. `resolve_dispute`       - authority (arbitrator) releases, refunds, or splits the escrow

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("Byjh8A9Zir4PXUPUDJufmC6xoii5LN9W2omdt5D9LUuw");

/// AI fraud scores (0-100, higher = more likely a scam/fraudulent listing)
/// at or below this threshold auto-activate the listing; above it, the
/// listing is Flagged for manual review instead of being taken down
/// outright.
pub const FRAUD_AUTO_APPROVE_THRESHOLD: u8 = 60;

pub const MAX_TITLE_LEN: usize = 80;
pub const MAX_URI_LEN: usize = 200;

#[program]
pub mod escrow_marketplace {
    use super::*;

    /// One-time setup of the global marketplace registry. `authority` is
    /// the platform operator / arbitrator that reviews listings and
    /// resolves disputes.
    pub fn initialize_marketplace(ctx: Context<InitializeMarketplace>) -> Result<()> {
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.authority = ctx.accounts.authority.key();
        marketplace.listing_count = 0;
        marketplace.bump = ctx.bumps.marketplace;
        Ok(())
    }

    /// List a property (for sale or to let) or a general item for a fixed
    /// price. Items are always for sale - `ToLet` only makes sense for
    /// `Property`. Starts `PendingReview` until the AI fraud screen runs.
    pub fn create_listing(
        ctx: Context<CreateListing>,
        category: ListingCategory,
        listing_type: ListingType,
        title: String,
        uri: String,
        price_lamports: u64,
    ) -> Result<()> {
        require!(title.len() <= MAX_TITLE_LEN, MarketplaceError::TitleTooLong);
        require!(uri.len() <= MAX_URI_LEN, MarketplaceError::UriTooLong);
        require!(price_lamports > 0, MarketplaceError::InvalidPrice);
        if category == ListingCategory::Item {
            require!(
                listing_type == ListingType::ForSale,
                MarketplaceError::InvalidListingType
            );
        }

        let marketplace = &mut ctx.accounts.marketplace;
        let listing = &mut ctx.accounts.listing;

        listing.id = marketplace.listing_count;
        listing.seller = ctx.accounts.seller.key();
        listing.category = category;
        listing.listing_type = listing_type;
        listing.title = title;
        listing.uri = uri;
        listing.price_lamports = price_lamports;
        listing.status = ListingStatus::PendingReview;
        listing.ai_fraud_score = 0;
        listing.reviewed = false;
        listing.order_count = 0;
        listing.created_at = Clock::get()?.unix_timestamp;
        listing.bump = ctx.bumps.listing;

        marketplace.listing_count = marketplace
            .listing_count
            .checked_add(1)
            .ok_or(MarketplaceError::MathOverflow)?;

        Ok(())
    }

    /// Authority-only: publish the AI fraud-screening score for a pending
    /// listing. Score at/under the threshold activates it; above, it's
    /// Flagged for manual review rather than taken down outright.
    pub fn review_listing(ctx: Context<ReviewListing>, ai_fraud_score: u8) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.marketplace.authority,
            ctx.accounts.authority.key(),
            MarketplaceError::Unauthorized
        );
        require!(ai_fraud_score <= 100, MarketplaceError::InvalidScore);

        let listing = &mut ctx.accounts.listing;
        require!(
            listing.status == ListingStatus::PendingReview,
            MarketplaceError::InvalidListingStatus
        );

        listing.ai_fraud_score = ai_fraud_score;
        listing.reviewed = true;
        listing.status = if ai_fraud_score <= FRAUD_AUTO_APPROVE_THRESHOLD {
            ListingStatus::Active
        } else {
            ListingStatus::Flagged
        };
        Ok(())
    }

    /// Authority-only: pull a listing at any time (compliance takedown,
    /// seller request, ...) as long as it has no funded order attached.
    pub fn remove_listing(ctx: Context<ReviewListing>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.marketplace.authority,
            ctx.accounts.authority.key(),
            MarketplaceError::Unauthorized
        );
        let listing = &mut ctx.accounts.listing;
        require!(
            matches!(
                listing.status,
                ListingStatus::PendingReview | ListingStatus::Active | ListingStatus::Flagged
            ),
            MarketplaceError::InvalidListingStatus
        );
        listing.status = ListingStatus::Removed;
        Ok(())
    }

    /// Buy-It-Now: a buyer pays the full listing price into an escrow
    /// vault PDA scoped to this specific order. No partial payments or
    /// counter-offers in this version - `amount_lamports` must equal the
    /// listing's price exactly.
    pub fn create_order(ctx: Context<CreateOrder>, amount_lamports: u64) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        require!(
            listing.status == ListingStatus::Active,
            MarketplaceError::InvalidListingStatus
        );
        require!(
            amount_lamports == listing.price_lamports,
            MarketplaceError::AmountMismatch
        );

        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
        system_program::transfer(cpi_ctx, amount_lamports)?;

        let order = &mut ctx.accounts.order;
        order.id = listing.order_count;
        order.listing = listing.key();
        order.buyer = ctx.accounts.buyer.key();
        order.seller = listing.seller;
        order.amount_lamports = amount_lamports;
        order.status = OrderStatus::Funded;
        order.dispute_reason_uri = String::new();
        order.created_at = Clock::get()?.unix_timestamp;
        order.bump = ctx.bumps.order;
        order.vault_bump = ctx.bumps.vault;

        listing.order_count = listing
            .order_count
            .checked_add(1)
            .ok_or(MarketplaceError::MathOverflow)?;
        listing.status = ListingStatus::UnderOffer;

        Ok(())
    }

    /// Buyer-only: confirm the item arrived / property handover happened.
    /// Releases the full escrowed amount to the seller.
    pub fn confirm_receipt(ctx: Context<ConfirmReceipt>) -> Result<()> {
        require!(
            ctx.accounts.order.status == OrderStatus::Funded,
            MarketplaceError::InvalidOrderStatus
        );

        let listing_key = ctx.accounts.listing.key();
        let order_id_bytes = ctx.accounts.order.id.to_le_bytes();
        let vault_bump = ctx.accounts.order.vault_bump;
        let signer_seeds: &[&[u8]] = &[
            b"order_vault",
            listing_key.as_ref(),
            &order_id_bytes,
            &[vault_bump],
        ];
        let signer_seeds_list = [signer_seeds];

        let vault_lamports = ctx.accounts.vault.lamports();
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.seller.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
            &signer_seeds_list,
        );
        system_program::transfer(cpi_ctx, vault_lamports)?;

        ctx.accounts.order.status = OrderStatus::Released;
        ctx.accounts.listing.status = ListingStatus::Sold;
        Ok(())
    }

    /// Either party calls off an unreleased, non-disputed order. The buyer
    /// is fully refunded and the listing re-opens for other buyers.
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        let order = &ctx.accounts.order;
        require!(
            ctx.accounts.signer.key() == order.buyer || ctx.accounts.signer.key() == order.seller,
            MarketplaceError::Unauthorized
        );
        require!(
            order.status == OrderStatus::Funded,
            MarketplaceError::InvalidOrderStatus
        );

        let listing_key = ctx.accounts.listing.key();
        let order_id_bytes = order.id.to_le_bytes();
        let vault_bump = order.vault_bump;
        let signer_seeds: &[&[u8]] = &[
            b"order_vault",
            listing_key.as_ref(),
            &order_id_bytes,
            &[vault_bump],
        ];
        let signer_seeds_list = [signer_seeds];

        let vault_lamports = ctx.accounts.vault.lamports();
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.buyer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
            &signer_seeds_list,
        );
        system_program::transfer(cpi_ctx, vault_lamports)?;

        ctx.accounts.order.status = OrderStatus::Cancelled;
        ctx.accounts.listing.status = ListingStatus::Active;
        Ok(())
    }

    /// Either party flags a problem with a funded order before receipt is
    /// confirmed. `reason_uri` points at off-chain evidence (messages,
    /// photos) - the backend's AI dispute-summarizer reads it to brief the
    /// arbitrator. Funds stay locked in escrow until `resolve_dispute`.
    pub fn open_dispute(ctx: Context<OpenDispute>, reason_uri: String) -> Result<()> {
        require!(
            reason_uri.len() <= MAX_URI_LEN,
            MarketplaceError::UriTooLong
        );
        let order = &mut ctx.accounts.order;
        require!(
            ctx.accounts.signer.key() == order.buyer || ctx.accounts.signer.key() == order.seller,
            MarketplaceError::Unauthorized
        );
        require!(
            order.status == OrderStatus::Funded,
            MarketplaceError::InvalidOrderStatus
        );

        order.status = OrderStatus::Disputed;
        order.dispute_reason_uri = reason_uri;
        Ok(())
    }

    /// Authority-only (arbitrator): resolve a disputed order by releasing
    /// the escrow to the seller, refunding the buyer, or splitting it
    /// between them.
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        resolution: DisputeResolution,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.marketplace.authority,
            ctx.accounts.authority.key(),
            MarketplaceError::Unauthorized
        );
        require!(
            ctx.accounts.order.status == OrderStatus::Disputed,
            MarketplaceError::InvalidOrderStatus
        );

        let listing_key = ctx.accounts.listing.key();
        let order_id_bytes = ctx.accounts.order.id.to_le_bytes();
        let vault_bump = ctx.accounts.order.vault_bump;
        let signer_seeds: &[&[u8]] = &[
            b"order_vault",
            listing_key.as_ref(),
            &order_id_bytes,
            &[vault_bump],
        ];
        let signer_seeds_list = [signer_seeds];
        let vault_lamports = ctx.accounts.vault.lamports();

        match resolution {
            DisputeResolution::ReleaseToSeller => {
                let cpi_accounts = system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    cpi_accounts,
                    &signer_seeds_list,
                );
                system_program::transfer(cpi_ctx, vault_lamports)?;
                ctx.accounts.listing.status = ListingStatus::Sold;
            }
            DisputeResolution::RefundBuyer => {
                let cpi_accounts = system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.buyer.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    cpi_accounts,
                    &signer_seeds_list,
                );
                system_program::transfer(cpi_ctx, vault_lamports)?;
                ctx.accounts.listing.status = ListingStatus::Active;
            }
            DisputeResolution::Split { seller_bps } => {
                require!(seller_bps <= 10_000, MarketplaceError::InvalidSplitBps);
                let seller_amount = (vault_lamports as u128)
                    .checked_mul(seller_bps as u128)
                    .ok_or(MarketplaceError::MathOverflow)?
                    .checked_div(10_000)
                    .ok_or(MarketplaceError::MathOverflow)?
                    as u64;
                let buyer_amount = vault_lamports
                    .checked_sub(seller_amount)
                    .ok_or(MarketplaceError::MathOverflow)?;

                if seller_amount > 0 {
                    let cpi_accounts = system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.seller.to_account_info(),
                    };
                    let cpi_ctx = CpiContext::new_with_signer(
                        ctx.accounts.system_program.to_account_info(),
                        cpi_accounts,
                        &signer_seeds_list,
                    );
                    system_program::transfer(cpi_ctx, seller_amount)?;
                }
                if buyer_amount > 0 {
                    let cpi_accounts = system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.buyer.to_account_info(),
                    };
                    let cpi_ctx = CpiContext::new_with_signer(
                        ctx.accounts.system_program.to_account_info(),
                        cpi_accounts,
                        &signer_seeds_list,
                    );
                    system_program::transfer(cpi_ctx, buyer_amount)?;
                }
                ctx.accounts.listing.status = ListingStatus::Sold;
            }
        }

        ctx.accounts.order.status = OrderStatus::Resolved;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeMarketplace<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Marketplace::INIT_SPACE,
        seeds = [b"marketplace"],
        bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateListing<'info> {
    #[account(mut, seeds = [b"marketplace"], bump = marketplace.bump)]
    pub marketplace: Account<'info, Marketplace>,

    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [b"listing", seller.key().as_ref(), &marketplace.listing_count.to_le_bytes()],
        bump
    )]
    pub listing: Account<'info, Listing>,

    #[account(mut)]
    pub seller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReviewListing<'info> {
    #[account(seeds = [b"marketplace"], bump = marketplace.bump)]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub listing: Account<'info, Listing>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateOrder<'info> {
    #[account(mut)]
    pub listing: Account<'info, Listing>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Order::INIT_SPACE,
        seeds = [b"order", listing.key().as_ref(), &listing.order_count.to_le_bytes()],
        bump
    )]
    pub order: Account<'info, Order>,

    /// Escrow vault for this specific order. Plain system-owned PDA - no
    /// account data, exists only to hold the buyer's payment until it's
    /// released, refunded, or split.
    /// CHECK: address is fully derived from seeds; no data is read from it.
    #[account(
        mut,
        seeds = [b"order_vault", listing.key().as_ref(), &listing.order_count.to_le_bytes()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfirmReceipt<'info> {
    #[account(mut, has_one = listing, has_one = buyer, has_one = seller)]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub listing: Account<'info, Listing>,

    #[account(
        mut,
        seeds = [b"order_vault", listing.key().as_ref(), &order.id.to_le_bytes()],
        bump = order.vault_bump
    )]
    /// CHECK: address is fully derived from seeds; no data is read from it.
    pub vault: AccountInfo<'info>,

    /// CHECK: lamport recipient, verified via `has_one = seller` on `order`.
    #[account(mut)]
    pub seller: AccountInfo<'info>,

    pub buyer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut, has_one = listing, has_one = buyer)]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub listing: Account<'info, Listing>,

    #[account(
        mut,
        seeds = [b"order_vault", listing.key().as_ref(), &order.id.to_le_bytes()],
        bump = order.vault_bump
    )]
    /// CHECK: address is fully derived from seeds; no data is read from it.
    pub vault: AccountInfo<'info>,

    /// CHECK: lamport recipient, verified via `has_one = buyer` on `order`.
    #[account(mut)]
    pub buyer: AccountInfo<'info>,

    /// Either the buyer or the seller may cancel; checked in the handler
    /// against `order.buyer` / `order.seller` (has_one only supports a
    /// single fixed match, not an OR).
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    #[account(mut, has_one = listing)]
    pub order: Account<'info, Order>,

    pub listing: Account<'info, Listing>,

    /// Either the buyer or the seller may open a dispute; checked in the
    /// handler against `order.buyer` / `order.seller`.
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(seeds = [b"marketplace"], bump = marketplace.bump)]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut, has_one = listing, has_one = buyer, has_one = seller)]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub listing: Account<'info, Listing>,

    #[account(
        mut,
        seeds = [b"order_vault", listing.key().as_ref(), &order.id.to_le_bytes()],
        bump = order.vault_bump
    )]
    /// CHECK: address is fully derived from seeds; no data is read from it.
    pub vault: AccountInfo<'info>,

    /// CHECK: lamport recipient, verified via `has_one = buyer` on `order`.
    #[account(mut)]
    pub buyer: AccountInfo<'info>,

    /// CHECK: lamport recipient, verified via `has_one = seller` on `order`.
    #[account(mut)]
    pub seller: AccountInfo<'info>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Marketplace {
    pub authority: Pubkey,
    pub listing_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub id: u64,
    pub seller: Pubkey,
    pub category: ListingCategory,
    pub listing_type: ListingType,
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
    /// Off-chain metadata URI (photos, full description, location/postcode
    /// for property, item condition, etc).
    #[max_len(MAX_URI_LEN)]
    pub uri: String,
    pub price_lamports: u64,
    pub status: ListingStatus,
    /// 0-100, higher = more likely fraudulent. Set once by `review_listing`.
    pub ai_fraud_score: u8,
    pub reviewed: bool,
    pub order_count: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Order {
    pub id: u64,
    pub listing: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount_lamports: u64,
    pub status: OrderStatus,
    /// Off-chain evidence URI for an open dispute (messages, photos). Empty
    /// until `open_dispute` is called.
    #[max_len(MAX_URI_LEN)]
    pub dispute_reason_uri: String,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ListingCategory {
    Property,
    Item,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ListingType {
    ForSale,
    ToLet,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ListingStatus {
    PendingReview,
    Active,
    Flagged,
    UnderOffer,
    Sold,
    Removed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum OrderStatus {
    Funded,
    Released,
    Disputed,
    Resolved,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DisputeResolution {
    ReleaseToSeller,
    RefundBuyer,
    /// Seller receives `seller_bps` / 10_000 of the escrow; the buyer gets
    /// the remainder.
    Split {
        seller_bps: u16,
    },
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum MarketplaceError {
    #[msg("Listing title exceeds max length")]
    TitleTooLong,
    #[msg("Metadata URI exceeds max length")]
    UriTooLong,
    #[msg("Price must be greater than zero")]
    InvalidPrice,
    #[msg("This listing type is not valid for this category")]
    InvalidListingType,
    #[msg("Fraud score must be between 0 and 100")]
    InvalidScore,
    #[msg("Listing is not in the required status for this action")]
    InvalidListingStatus,
    #[msg("Order is not in the required status for this action")]
    InvalidOrderStatus,
    #[msg("Payment amount does not match the listing price")]
    AmountMismatch,
    #[msg("Split basis points must be between 0 and 10000")]
    InvalidSplitBps,
    #[msg("Signer is not authorized to perform this action")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
