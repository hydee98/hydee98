//! Escrow Marketplace Program
//!
//! A peer-to-peer marketplace for property (for sale or to let) and general
//! items - the eBay/Zoopla model - priced in USD and paid for in **USDC**,
//! with the payment held in an on-chain escrow vault until the buyer
//! confirms receipt/handover. A small platform fee (`fee_bps`, basis
//! points) is taken out of the seller's payout **only when a sale actually
//! completes** - never on a refund/cancellation - and routed to a
//! `treasury` wallet for buyback/reward distribution to the platform's
//! token holders.
//!
//! **Why USDC only, on-chain, instead of "any of SOL/USDT/SKR/...":** this
//! program never swaps currencies itself, and it never will via a
//! custodial backend wallet either - a server holding the authority to
//! swap users' deposited funds is a major security/regulatory liability
//! this design avoids entirely. A buyer who wants to pay with something
//! other than USDC swaps it in their *own* wallet (e.g. via a DEX
//! aggregator like Jupiter) *before* calling `create_order` - by the time
//! this program ever sees a deposit, it is already USDC. See
//! `app/frontend/src/lib/jupiterSwap.ts` for that client-side swap step.
//!
//! An off-chain AI service (see `app/backend`) screens new listings for
//! fraud/scam signals; the platform authority publishes that score
//! on-chain via `review_listing`, which gates whether a listing opens for
//! purchase. Solana programs can't make outbound HTTP calls, so - as with
//! any oracle-style integration - the AI step itself happens off-chain and
//! only its result is attested here.
//!
//! Flow:
//!   1. `initialize_marketplace` - authority sets usdc_mint/treasury/fee_bps
//!   2. `set_fee_config`         - authority can update treasury/fee_bps later
//!   3. `create_listing`        - a seller lists a property or item (PendingReview)
//!   4. `review_listing`        - authority publishes the AI fraud score, listing goes Active/Flagged
//!   5. `remove_listing`        - authority can pull a listing at any time (compliance)
//!   6. `create_order`          - a buyer pays the listing price (USDC) into escrow (Buy-It-Now, no offers)
//!   7. `confirm_receipt`       - buyer confirms delivery/handover; fee -> treasury, remainder -> seller
//!   8. `cancel_order`          - buyer or seller calls off an unreleased order; buyer refunded in full, no fee
//!   9. `open_dispute`          - buyer or seller flags a problem before receipt is confirmed
//!  10. `resolve_dispute`       - authority (arbitrator) releases (fee applies), refunds (no fee), or splits (fee on the seller's share) the escrow

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Byjh8A9Zir4PXUPUDJufmC6xoii5LN9W2omdt5D9LUuw");

/// AI fraud scores (0-100, higher = more likely a scam/fraudulent listing)
/// at or below this threshold auto-activate the listing; above it, the
/// listing is Flagged for manual review instead of being taken down
/// outright.
pub const FRAUD_AUTO_APPROVE_THRESHOLD: u8 = 60;

pub const MAX_TITLE_LEN: usize = 80;
pub const MAX_URI_LEN: usize = 200;

/// Sanity cap on the platform fee - never allow configuring it above 20%,
/// regardless of who holds the authority key.
pub const MAX_FEE_BPS: u16 = 2_000;

/// Splits `amount` into (fee, net) at `fee_bps` basis points (1/100th of a
/// percent), e.g. 200 = 2%. Fee math happens in u128 to avoid overflow on
/// the intermediate multiply before dividing back down to u64.
fn split_fee(amount: u64, fee_bps: u16) -> Result<(u64, u64)> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(MarketplaceError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(MarketplaceError::MathOverflow)? as u64;
    let net = amount
        .checked_sub(fee)
        .ok_or(MarketplaceError::MathOverflow)?;
    Ok((fee, net))
}

#[program]
pub mod escrow_marketplace {
    use super::*;

    /// One-time setup of the global marketplace registry. `authority` is
    /// the platform operator / arbitrator that reviews listings and
    /// resolves disputes. `usdc_mint` pins the program to a single
    /// stablecoin mint (devnet or mainnet USDC); `treasury` is the wallet
    /// that accumulates the completed-sale fee for buyback/rewards.
    pub fn initialize_marketplace(
        ctx: Context<InitializeMarketplace>,
        usdc_mint: Pubkey,
        treasury: Pubkey,
        fee_bps: u16,
    ) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, MarketplaceError::InvalidFeeBps);
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.authority = ctx.accounts.authority.key();
        marketplace.usdc_mint = usdc_mint;
        marketplace.treasury = treasury;
        marketplace.fee_bps = fee_bps;
        marketplace.listing_count = 0;
        marketplace.bump = ctx.bumps.marketplace;
        Ok(())
    }

    /// Authority-only: update the treasury wallet and/or fee rate. Takes
    /// effect on the next `confirm_receipt`/`resolve_dispute` - orders
    /// already in flight settle at whatever rate is live when they close.
    pub fn set_fee_config(
        ctx: Context<SetFeeConfig>,
        treasury: Pubkey,
        fee_bps: u16,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.marketplace.authority,
            ctx.accounts.authority.key(),
            MarketplaceError::Unauthorized
        );
        require!(fee_bps <= MAX_FEE_BPS, MarketplaceError::InvalidFeeBps);
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.treasury = treasury;
        marketplace.fee_bps = fee_bps;
        Ok(())
    }

    /// List a property (for sale or to let) or a general item for a fixed
    /// USDC price. Items are always for sale - `ToLet` only makes sense
    /// for `Property`. Starts `PendingReview` until the AI fraud screen
    /// runs.
    pub fn create_listing(
        ctx: Context<CreateListing>,
        category: ListingCategory,
        listing_type: ListingType,
        title: String,
        uri: String,
        price_usdc: u64,
    ) -> Result<()> {
        require!(title.len() <= MAX_TITLE_LEN, MarketplaceError::TitleTooLong);
        require!(uri.len() <= MAX_URI_LEN, MarketplaceError::UriTooLong);
        require!(price_usdc > 0, MarketplaceError::InvalidPrice);
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
        listing.price_usdc = price_usdc;
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

    /// Buy-It-Now: a buyer pays the full listing price, in USDC, into an
    /// escrow token account scoped to this specific order. No partial
    /// payments or counter-offers in this version - `amount_usdc` must
    /// equal the listing's price exactly. The buyer's wallet must already
    /// hold USDC - swap into it first (see module docs) if paying with
    /// something else.
    pub fn create_order(ctx: Context<CreateOrder>, amount_usdc: u64) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        require!(
            listing.status == ListingStatus::Active,
            MarketplaceError::InvalidListingStatus
        );
        require!(
            amount_usdc == listing.price_usdc,
            MarketplaceError::AmountMismatch
        );

        let cpi_accounts = Transfer {
            from: ctx.accounts.buyer_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount_usdc)?;

        let order = &mut ctx.accounts.order;
        order.id = listing.order_count;
        order.listing = listing.key();
        order.buyer = ctx.accounts.buyer.key();
        order.seller = listing.seller;
        order.amount_usdc = amount_usdc;
        order.status = OrderStatus::Funded;
        order.dispute_reason_uri = String::new();
        order.created_at = Clock::get()?.unix_timestamp;
        order.bump = ctx.bumps.order;
        order.vault_bump = ctx.bumps.vault_authority;

        listing.order_count = listing
            .order_count
            .checked_add(1)
            .ok_or(MarketplaceError::MathOverflow)?;
        listing.status = ListingStatus::UnderOffer;

        Ok(())
    }

    /// Buyer-only: confirm the item arrived / property handover happened.
    /// Splits the escrowed USDC - `fee_bps` to the treasury, the
    /// remainder to the seller.
    pub fn confirm_receipt(ctx: Context<ConfirmReceipt>) -> Result<()> {
        require!(
            ctx.accounts.order.status == OrderStatus::Funded,
            MarketplaceError::InvalidOrderStatus
        );

        let (fee, seller_net) = split_fee(
            ctx.accounts.order.amount_usdc,
            ctx.accounts.marketplace.fee_bps,
        )?;

        let listing_key = ctx.accounts.listing.key();
        let order_id_bytes = ctx.accounts.order.id.to_le_bytes();
        let vault_bump = ctx.accounts.order.vault_bump;
        let signer_seeds: &[&[u8]] = &[
            b"vault_authority",
            listing_key.as_ref(),
            &order_id_bytes,
            &[vault_bump],
        ];
        let signer_seeds_list = [signer_seeds];

        if fee > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                &signer_seeds_list,
            );
            token::transfer(cpi_ctx, fee)?;
        }

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.seller_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &signer_seeds_list,
        );
        token::transfer(cpi_ctx, seller_net)?;

        ctx.accounts.order.status = OrderStatus::Released;
        ctx.accounts.listing.status = ListingStatus::Sold;
        Ok(())
    }

    /// Either party calls off an unreleased, non-disputed order. The buyer
    /// is refunded the full amount - no fee on a cancellation - and the
    /// listing re-opens for other buyers.
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
            b"vault_authority",
            listing_key.as_ref(),
            &order_id_bytes,
            &[vault_bump],
        ];
        let signer_seeds_list = [signer_seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &signer_seeds_list,
        );
        token::transfer(cpi_ctx, order.amount_usdc)?;

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
    /// the escrow to the seller (fee applies), refunding the buyer (no
    /// fee), or splitting it between them (fee applies to the seller's
    /// share only).
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
            b"vault_authority",
            listing_key.as_ref(),
            &order_id_bytes,
            &[vault_bump],
        ];
        let signer_seeds_list = [signer_seeds];
        let amount = ctx.accounts.order.amount_usdc;
        let fee_bps = ctx.accounts.marketplace.fee_bps;

        match resolution {
            DisputeResolution::ReleaseToSeller => {
                let (fee, seller_net) = split_fee(amount, fee_bps)?;
                if fee > 0 {
                    let cpi_accounts = Transfer {
                        from: ctx.accounts.vault_token_account.to_account_info(),
                        to: ctx.accounts.treasury_token_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    };
                    let cpi_ctx = CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        cpi_accounts,
                        &signer_seeds_list,
                    );
                    token::transfer(cpi_ctx, fee)?;
                }
                let cpi_accounts = Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.seller_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    &signer_seeds_list,
                );
                token::transfer(cpi_ctx, seller_net)?;
                ctx.accounts.listing.status = ListingStatus::Sold;
            }
            DisputeResolution::RefundBuyer => {
                let cpi_accounts = Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    &signer_seeds_list,
                );
                token::transfer(cpi_ctx, amount)?;
                ctx.accounts.listing.status = ListingStatus::Active;
            }
            DisputeResolution::Split { seller_bps } => {
                require!(seller_bps <= 10_000, MarketplaceError::InvalidSplitBps);
                let seller_gross = (amount as u128)
                    .checked_mul(seller_bps as u128)
                    .ok_or(MarketplaceError::MathOverflow)?
                    .checked_div(10_000)
                    .ok_or(MarketplaceError::MathOverflow)?
                    as u64;
                let buyer_amount = amount
                    .checked_sub(seller_gross)
                    .ok_or(MarketplaceError::MathOverflow)?;
                let (fee, seller_net) = split_fee(seller_gross, fee_bps)?;

                if fee > 0 {
                    let cpi_accounts = Transfer {
                        from: ctx.accounts.vault_token_account.to_account_info(),
                        to: ctx.accounts.treasury_token_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    };
                    let cpi_ctx = CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        cpi_accounts,
                        &signer_seeds_list,
                    );
                    token::transfer(cpi_ctx, fee)?;
                }
                if seller_net > 0 {
                    let cpi_accounts = Transfer {
                        from: ctx.accounts.vault_token_account.to_account_info(),
                        to: ctx.accounts.seller_token_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    };
                    let cpi_ctx = CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        cpi_accounts,
                        &signer_seeds_list,
                    );
                    token::transfer(cpi_ctx, seller_net)?;
                }
                if buyer_amount > 0 {
                    let cpi_accounts = Transfer {
                        from: ctx.accounts.vault_token_account.to_account_info(),
                        to: ctx.accounts.buyer_token_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    };
                    let cpi_ctx = CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        cpi_accounts,
                        &signer_seeds_list,
                    );
                    token::transfer(cpi_ctx, buyer_amount)?;
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
pub struct SetFeeConfig<'info> {
    #[account(mut, seeds = [b"marketplace"], bump = marketplace.bump)]
    pub marketplace: Account<'info, Marketplace>,

    pub authority: Signer<'info>,
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
    #[account(seeds = [b"marketplace"], bump = marketplace.bump)]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub listing: Account<'info, Listing>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(address = marketplace.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Order::INIT_SPACE,
        seeds = [b"order", listing.key().as_ref(), &listing.order_count.to_le_bytes()],
        bump
    )]
    pub order: Account<'info, Order>,

    /// Signing authority over this order's escrow token account - holds no
    /// data of its own, exists purely to authorize outgoing transfers via
    /// `invoke_signed`.
    /// CHECK: address is fully derived from seeds; no data is read from it.
    #[account(
        seeds = [b"vault_authority", listing.key().as_ref(), &listing.order_count.to_le_bytes()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(
        init,
        payer = buyer,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ConfirmReceipt<'info> {
    #[account(seeds = [b"marketplace"], bump = marketplace.bump)]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub listing: Account<'info, Listing>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut, has_one = listing, has_one = buyer)]
    pub order: Account<'info, Order>,

    #[account(address = marketplace.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: address is fully derived from seeds; no data is read from it.
    #[account(
        seeds = [b"vault_authority", listing.key().as_ref(), &order.id.to_le_bytes()],
        bump = order.vault_bump
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: address is constrained to order.seller; only used as the
    /// seller's ATA authority (never read/written directly).
    #[account(address = order.seller)]
    pub seller: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = usdc_mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// CHECK: address is constrained to marketplace.treasury; only used as
    /// the treasury's ATA authority (never read/written directly).
    #[account(address = marketplace.treasury)]
    pub treasury: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = usdc_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(seeds = [b"marketplace"], bump = marketplace.bump)]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub listing: Account<'info, Listing>,

    /// Either the buyer or the seller may cancel; checked in the handler
    /// against `order.buyer` / `order.seller` (has_one only supports a
    /// single fixed match, not an OR).
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(mut, has_one = listing)]
    pub order: Account<'info, Order>,

    #[account(address = marketplace.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: address is fully derived from seeds; no data is read from it.
    #[account(
        seeds = [b"vault_authority", listing.key().as_ref(), &order.id.to_le_bytes()],
        bump = order.vault_bump
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: address is constrained to order.buyer; only used as the
    /// buyer's ATA authority (never read/written directly).
    #[account(address = order.buyer)]
    pub buyer: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
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

    #[account(mut)]
    pub listing: Account<'info, Listing>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, has_one = listing)]
    pub order: Account<'info, Order>,

    #[account(address = marketplace.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: address is fully derived from seeds; no data is read from it.
    #[account(
        seeds = [b"vault_authority", listing.key().as_ref(), &order.id.to_le_bytes()],
        bump = order.vault_bump
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: address is constrained to order.buyer; only used as the
    /// buyer's ATA authority (never read/written directly).
    #[account(address = order.buyer)]
    pub buyer: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// CHECK: address is constrained to order.seller; only used as the
    /// seller's ATA authority (never read/written directly).
    #[account(address = order.seller)]
    pub seller: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// CHECK: address is constrained to marketplace.treasury; only used as
    /// the treasury's ATA authority (never read/written directly).
    #[account(address = marketplace.treasury)]
    pub treasury: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Marketplace {
    pub authority: Pubkey,
    /// The single stablecoin mint this deployment escrows (e.g. USDC).
    pub usdc_mint: Pubkey,
    /// Wallet that receives the completed-sale fee - funds buyback and
    /// reward distribution for the platform token.
    pub treasury: Pubkey,
    /// Platform fee in basis points (100 = 1%), taken out of the seller's
    /// payout only when a sale actually completes.
    pub fee_bps: u16,
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
    /// Price in USDC base units (6 decimals, i.e. 1_000_000 = $1).
    pub price_usdc: u64,
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
    /// Escrowed amount in USDC base units.
    pub amount_usdc: u64,
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
    /// Seller receives `seller_bps` / 10_000 of the escrow (fee deducted
    /// from that share); the buyer gets the remainder (never fee'd).
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
    #[msg("Fee must be between 0 and 20% (2000 bps)")]
    InvalidFeeBps,
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
