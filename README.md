# MarketAI - Peer-to-Peer Marketplace with Crypto Escrow + AI

A Zoopla/eBay-style marketplace - list a property (for sale or to let) or a
general item, priced in USD - where payment sits in an on-chain **USDC**
escrow vault until the buyer confirms receipt/handover, and an AI layer
(Claude) screens listings for fraud, suggests fair prices, answers buyer
questions, and briefs the human arbitrator when a dispute is opened.
Buyers can pay with USDC, USDT, SOL, or (once it launches) the platform's
own SKR token - see [Economics](#economics-pricing-multi-currency-payments--the-platform-fee)
for how that maps to a single USDC escrow. Accounts are your Solana wallet
(sign a message, no email/password), listings carry real photos, and
Browse has search + price/location filters.

> **Status: reference implementation / scaffold.** The Anchor program
> compiles cleanly (`cargo check` passes) and the backend + frontend build
> and run end-to-end - Postgres-backed and persistent when `DATABASE_URL`
> is set, an in-memory demo dataset otherwise. The program has **not been
> deployed** to any cluster - this sandbox has no Solana/Anchor CLI
> available (see [Known limitations](#known-limitations--how-to-finish-the-loop)
> for exactly what that means and how to close the gap).

## The model

- **Your wallet is your account.** No signup form: connect a Solana wallet
  and sign a short-lived message (free, no transaction, no gas) to prove
  you own it. That signature is your session - see
  [Accounts, photos & search](#accounts-photos--search) below.
- **List it.** A signed-in seller lists a property (for sale or to let) or
  a general item at a fixed price, with real photos. Every new listing
  starts `PendingReview`.
- **AI screens it.** Before it goes live, Claude reads the listing for scam
  signals - pressure tactics, "pay off-platform", prices that don't add up,
  vague descriptions - and produces a fraud score. Low score → `Active`;
  high score → `Flagged` for human review, not an automatic takedown.
- **Buy It Now.** A buyer pays the listed price - in USDC, USDT, SOL, or
  SKR - into a per-order escrow vault. Whatever they pay with, the vault
  itself always holds USDC: paying with anything else swaps into USDC in
  the buyer's *own* wallet first, so neither the backend nor the on-chain
  program ever custodies a non-USDC balance. No haggling in this version -
  it's a fixed-price purchase, like eBay's Buy It Now.
- **Confirm receipt.** Once the item arrives or the property handover
  happens, the buyer confirms it - only then does the escrow release to the
  seller. Nobody gets paid on listing a "sale"; they get paid on delivery.
- **Or dispute it.** Either party can flag a problem before confirming.
  Claude reads both sides' messages and briefs a human arbitrator with a
  neutral summary and a suggested resolution (release / refund / split) -
  the AI recommends, a person (or eventually a proper arbitration process)
  decides and executes on-chain.

Solana enforces the *mechanics* (funds only move on `confirm_receipt` or an
authority-signed `resolve_dispute`, a listing can't be bought twice at
once); the AI provides *judgment* - a first-pass fraud screen and dispute
brief - that a human attests to or acts on. Solana programs can't make
outbound HTTP calls, so, as with any oracle-style integration, the AI step
itself runs off-chain and only its result is written on-chain.

## Architecture

```
┌──────────────────┐      HTTP       ┌───────────────────┐     Anthropic API    ┌───────────┐
│  React frontend  │◀───────────────▶│   Express backend  │◀─────────────────────▶│  Claude   │
│  (Vite, wallet-  │                 │  (TypeScript)       │  fraud screen / price  │ (claude-  │
│   adapter)        │                 │                     │  suggestion / chat /   │  opus-5)  │
└────────┬─────────┘                 └──────────┬──────────┘  dispute summary        └───────────┘
         │ 1. swaps SOL/USDT/SKR -> USDC          │ reads (health check, future: decode
         │    in the buyer's own wallet           │ on-chain Listing/Order/Marketplace accounts)
         │    (Jupiter - lib/jupiterSwap.ts)
         │ 2. signs & sends create_order /
         │    confirm_receipt (USDC only)
         ▼                                        ▼
┌──────────────────────────────────────────────────────────┐
│                Solana (devnet / localnet)                 │
│  escrow_marketplace Anchor program                         │
│  Marketplace(usdc_mint,treasury,fee_bps)                    │
│    → Listing → Order (+ USDC vault) → dispute                │
│  confirm_receipt: fee_bps -> treasury, remainder -> seller  │
└──────────────────────────────────────────────────────────┘
```

## Repository layout

```
programs/escrow_marketplace/  Anchor/Rust program: listings, escrow orders, disputes
tests/escrow_marketplace.ts   Anchor mocha test suite
Anchor.toml, Cargo.toml       Anchor workspace config

app/backend/                  Express + TypeScript API
  src/services/aiService.ts     Claude integration: fraud screen, price suggestion, chat, dispute summary
  src/services/authService.ts   Sign-in with Solana: nonce issuance, signature verification, JWT sessions
  src/services/solanaService.ts PDA derivation + read-side cluster/program health check
  src/services/pricingService.ts Mock USDC/USDT/SOL/SKR exchange rates + the 2% platform fee constant
  src/middleware/requireAuth.ts  Gates routes behind a valid wallet session (req.auth.publicKey)
  src/middleware/adminAuth.ts    Gates arbitrator-only routes behind ADMIN_TOKEN
  src/data/listings.ts          Listing store - Postgres when DATABASE_URL is set, in-memory otherwise
  src/data/orders.ts             Order/escrow store, same dual-mode pattern
  src/data/users.ts              User store (keyed by wallet public key), same dual-mode pattern
  src/db/                        Postgres pool + idempotent schema/seed migration
  src/routes/                    REST routes (auth, listings, orders, ai)

app/frontend/                 React + Vite + TypeScript dApp
  src/pages/Browse.tsx           Search + filters, category tabs, listing grid
  src/pages/ListingDetail.tsx    Photo gallery, AI fraud/price panels, chat, Buy It Now (+ currency picker)
  src/pages/Orders.tsx           Your buying/selling orders: confirm receipt / cancel / dispute
  src/pages/Disputes.tsx         Arbitrator view: AI dispute summary + resolve
  src/pages/CreateListing.tsx    Seller "list something for sale" form with photo upload
  src/context/AuthContext.tsx    Wallet sign-in state (nonce -> signMessage -> session)
  src/components/SignInGate.tsx  Gates an action behind wallet sign-in
  src/components/AdminGate.tsx   Gates an action behind the arbitrator admin token
  src/lib/anchorIx.ts            Hand-encoded create_order/confirm_receipt for SPL/USDC (no IDL/Anchor-CLI dependency)
  src/lib/jupiterSwap.ts         Client-side SOL/USDT/SKR -> USDC swap via Jupiter, ahead of create_order
  src/lib/imageCompress.ts       Client-side photo resize/compression before upload
  src/wallet/                    Solana wallet-adapter context (Wallet Standard auto-detection)
```

## The on-chain program (`programs/escrow_marketplace`)

Instructions:

| Instruction | Who | What it does |
|---|---|---|
| `initialize_marketplace` | platform authority | One-time setup of the global `Marketplace` account: pins the `usdc_mint`, sets the `treasury` wallet and `fee_bps`. |
| `set_fee_config` | authority | Updates the treasury wallet and/or fee rate later without redeploying. |
| `create_listing` | seller | Lists a `Property` (for sale or to let) or an `Item` (always for sale) at a fixed USDC price. Starts `PendingReview`. |
| `review_listing` | authority | Publishes the AI fraud score. Score ≤ 60 → `Active`; above → `Flagged`. This is the on-chain attestation of the backend's `screenListingForFraud()` call. |
| `remove_listing` | authority | Pulls a listing at any time (compliance), as long as no order is attached. |
| `create_order` | buyer | Buy-It-Now: pays the listing price, in USDC, into a per-order escrow token account owned by a `vault_authority` PDA. Listing moves to `UnderOffer`. |
| `confirm_receipt` | buyer | Confirms delivery/handover - splits the escrowed USDC: `fee_bps` to the treasury, the remainder to the seller. |
| `cancel_order` | buyer or seller | Calls off an unreleased order; buyer is refunded in full (no fee), listing re-opens. |
| `open_dispute` | buyer or seller | Flags a problem before receipt is confirmed; funds stay locked. |
| `resolve_dispute` | authority (arbitrator) | Releases to the seller (fee applies), refunds the buyer (no fee), or splits the escrow by basis points (fee applies only to the seller's share). |

State: `Marketplace` (authority, `usdc_mint`, `treasury`, `fee_bps`,
listing count), `Listing` (seller, category, type, title, metadata URI,
`price_usdc`, status, `ai_fraud_score`, `order_count`), `Order` (listing,
buyer, seller, `amount_usdc`, status, dispute evidence URI, vault bump).
All addresses are PDAs so client code can derive them without an RPC
round-trip - seeds are mirrored in both
`app/backend/src/services/solanaService.ts` and `app/frontend/src/lib/solana.ts`.

**Why USDC-only on-chain, with USDC/USDT/SOL/SKR at the door:** the
program (and this backend) never swap currencies themselves - a server or
program holding swap authority over deposited user funds is a security
and regulatory liability this design avoids entirely. A buyer who wants
to pay with SOL/USDT/SKR swaps it into USDC *in their own wallet* (via
Jupiter's aggregator - see `app/frontend/src/lib/jupiterSwap.ts`) before
`create_order` ever runs. By the time the program sees a deposit, it is
already USDC - the on-chain escrow logic never needs to know or care what
the buyer originally held.

## The AI layer (`app/backend/src/services/aiService.ts`)

Four capabilities, each a Claude API call (model: `claude-opus-5`, adaptive
thinking) with a strict "respond with only a JSON object" system prompt
(except chat, which is free text) and a tolerant JSON extractor on the
response:

- **`screenListingForFraud`** - 0-100 fraud score + recommendation +
  concrete red flags. What an authority would relay into `review_listing`
  on-chain.
- **`suggestPrice`** - a fair-price range in USD given the listing's own
  description, explicit about having no live market data feed.
- **`answerListingQuestion`** - buyer Q&A grounded only in that listing's
  own description, refuses to invent condition details or guarantees.
- **`summarizeDispute`** - reads both sides' dispute messages and briefs
  the arbitrator with a neutral summary and a suggested resolution - it
  recommends, a human decides.

All four gracefully degrade to a clear `503` ("AI features are not
configured: set ANTHROPIC_API_KEY...") when no key is present, so the rest
of the app keeps working without one.

## Economics: pricing, multi-currency payments & the platform fee

- **Everything is priced in USD.** A listing's price (`priceUsd`) is the
  single number sellers set and buyers see - no separate "guide price" vs
  "escrow amount" conversion, because USDC is pegged 1:1 to the dollar.
- **Pay with USDC, USDT, SOL, or SKR.** The Buy panel's currency picker
  shows a live-ish conversion (`GET /api/pricing/rates`,
  `app/backend/src/services/pricingService.ts`) of the listing's USD price
  into whichever currency the buyer picks. Choosing anything other than
  USDC means their wallet swaps into USDC first (client-side, via Jupiter
  - see `app/frontend/src/lib/jupiterSwap.ts`) before `create_order` runs;
  escrow itself only ever holds USDC. SOL's rate is an illustrative fixed
  number here - a live deployment should source it from the same DEX quote
  used for the actual swap instead of a hardcoded constant.
- **SKR is a placeholder.** It's the platform's own token, and it hasn't
  launched yet - `isPlaceholderCurrency()` flags it everywhere (API
  response, currency picker label) so nobody mistakes the mock rate for a
  real, liquid market. Once SKR has an actual mint and market, replace
  `MOCK_USD_RATES.SKR` with a live quote (Jupiter will pick it up
  automatically once it's routable) and drop the placeholder flag.
- **The 2% platform fee is taken only when a sale completes.** Not on
  funding, not on a refund or cancellation - only on `confirm_receipt` or
  a paying-out `resolve_dispute` branch, computed on-chain as
  `amount * fee_bps / 10_000` and routed straight to the `treasury`
  wallet in the same transaction that pays the seller. `Order.feeUsd` in
  the backend/frontend is purely informational (shown before an order
  ever gets to a release step) - the real deduction is enforced by the
  Anchor program, not by anything this Express server does.
- **The treasury funds buyback and rewards for the platform token you
  mentioned building.** This repo doesn't implement that token or the
  buyback mechanism itself (out of scope here) - `TREASURY_WALLET` is just
  the destination address the fee accumulates in; wire up the actual
  buyback/distribution logic as its own system once that token exists.

## Accounts, photos & search

**Sign-in with Solana** (`app/backend/src/services/authService.ts`,
`src/routes/auth.ts`): the frontend asks for a nonce
(`POST /api/auth/nonce`), the connected wallet signs it (`signMessage` -
free, no transaction), and the backend verifies the signature against the
claimed public key (`tweetnacl`) before issuing a JWT session
(`POST /api/auth/verify`). No password, no email, no separate signup - the
first successful verify for a wallet creates its `User` row. Listings and
orders always take their seller/buyer identity from this session
(`req.auth.publicKey`), never from a client-supplied field, so e.g. a
seller can't buy their own listing and only the actual buyer can confirm
receipt - the same integrity guarantees the on-chain program enforces via
transaction signers. Requires `JWT_SECRET`; unset, sign-in returns a clear
`503` rather than crashing.

**Photos**: sellers attach real photos when listing (`app/frontend/src/lib/imageCompress.ts`
resizes/re-encodes client-side via `<canvas>` before upload, capped at 6
images), stored as data URLs inside the listing's JSONB row - no separate
object storage service to provision. `ListingCard` and the listing-detail
gallery fall back to a category icon placeholder if a listing has no
photos (or a demo seed listing's placeholder URL doesn't resolve).

**Search + filters**: `GET /api/listings` takes `q` (title/description
substring), `location`, `minPrice`/`maxPrice` (USD), `listingType`, and
`category` query params, filtered server-side - wired to a debounced
search bar and a filters panel on Browse.

## Getting started

### Prerequisites

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/) for the AI features
- To build/deploy the on-chain program: [Solana CLI + Anchor CLI](https://www.anchor-lang.com/docs/installation) (not required to run the backend/frontend against the demo dataset)

### 1. Install dependencies

```bash
npm install
```

This installs both npm workspaces (`app/backend`, `app/frontend`) plus the
root-level Anchor test dependencies.

### 2. Backend

```bash
cp app/backend/.env.example app/backend/.env
# edit app/backend/.env and set ANTHROPIC_API_KEY

npm run dev:backend      # http://localhost:8787
```

That's enough to run everything except:
- **Arbitrator actions** (resolving a dispute, its AI summary, applying a
  fraud score) - need `ADMIN_TOKEN` set; any string works locally.
- **Signing in** (and anything that requires it: listing something, buying,
  confirming receipt, disputes) - needs `JWT_SECRET` set; any string works
  locally.

Leave `DATABASE_URL` unset to use the in-memory store, or point it at a
local Postgres to test persistence (see `.env.example` for the connection
string shape).

`GET /api/health` reports whether the AI key, the database, the admin
token, and sign-in are configured, and whether the configured Solana
RPC/program is reachable.

### 3. Frontend

```bash
cp app/frontend/.env.example app/frontend/.env   # defaults are fine for local dev
npm run dev:frontend      # http://localhost:5173, proxies /api to the backend
```

Open http://localhost:5173 - browse the demo listings (a house for sale, a
flat to let, a few items - including one deliberately scammy-sounding
listing so you can see the fraud screen actually flag something), run the
AI fraud/price panels, chat about a listing, and connect a wallet (any
Wallet Standard wallet - Phantom, Solflare, Backpack, ...) to sign in and
walk through listing something with real photos, Buy It Now → Orders →
confirm receipt or open a dispute → Disputes (arbitrator view with the AI
summary, gated by `ADMIN_TOKEN`).

### 4. Publishing this live

You don't need the Solana program deployed to put the demo on a real URL -
the current build's Buy It Now flow runs through the backend's own escrow
simulation, not a live chain. Two pieces to host: the Express backend (a
long-running Node process, not a static file) and the Vite frontend (a
static build).

**Fastest path - Render, one account, everything from `render.yaml`:**

1. Push this repo to GitHub (already done if you're reading this on a
   pushed branch).
2. In the [Render dashboard](https://dashboard.render.com/): **New →
   Blueprint**, pick this repo. Render reads `render.yaml` at the repo root
   and provisions three things: a free Postgres database (`marketai-db`),
   the backend (`marketai-backend`, a Node web service), and the frontend
   (`marketai-frontend`, a static site).
3. Render will pause on `ANTHROPIC_API_KEY` (marked `sync: false` in the
   blueprint so a real key never gets committed) - paste your key into the
   backend service's Environment tab. `DATABASE_URL`, `ADMIN_TOKEN`, and
   `JWT_SECRET` are wired up automatically - Postgres's connection string
   is injected from the database resource, and the other two are random
   secrets Render generates for you (`generateValue: true`). Find the
   generated `ADMIN_TOKEN` afterward in the backend service's Environment
   tab - you'll need it to unlock the arbitrator actions on `/disputes`
   (`JWT_SECRET` you'll never need to touch - it just needs to exist).
   `USDC_MINT`/`VITE_USDC_MINT` default to devnet USDC and `PLATFORM_FEE_BPS`
   defaults to 200 (2%) - all fine to leave as-is for a demo. Render will
   also pause on `TREASURY_WALLET`/`VITE_TREASURY_WALLET` (`sync: false`,
   same reason as the API key) - set both to the same real treasury wallet
   before going live; for a quick demo you can paste in any valid Solana
   address (see [Economics](#economics-pricing-multi-currency-payments--the-platform-fee)).
4. Both web services get a `https://<service-name>.onrender.com` URL by
   default - **but only if that plain name isn't already taken by someone
   else's Render service**, in which case Render silently appends a
   `-xxxx` suffix (e.g. `marketai-backend-a1b2.onrender.com`) instead.
   `render.yaml` sets `VITE_API_BASE_URL` and `CORS_ORIGIN` via `fromService`
   rather than a hardcoded guess at the clean URL, specifically so this
   resolves to whichever host Render actually assigned, suffix and all -
   if you ever see wallet sign-in fail with a bare "Request failed with
   status 404" (no specific error message), that's this exact mismatch:
   the frontend was built against a backend URL that doesn't exist.
   Redeploying from an updated `render.yaml` fixes it automatically; to
   confirm without waiting on a build, open both services' Environment
   tabs in the Render dashboard and check `VITE_API_BASE_URL` actually
   matches the backend's real `.onrender.com` URL (and `CORS_ORIGIN`
   matches the frontend's).
5. Deploy. First build takes a few minutes; the free tier backend spins
   down after inactivity and takes ~30s to wake on the next request (fine
   for a demo, upgrade the plan for something you don't want to feel slow).
   The free Postgres tier is deleted after 30 days of inactivity - fine for
   a demo, upgrade before that matters to you.

**Equally valid alternative** - frontend on Vercel/Netlify (Vite is a
first-class preset on both) + backend on Render/Railway/Fly.io + a
Postgres instance from any of those or a dedicated provider (Neon,
Supabase). Same idea: set `VITE_API_BASE_URL` on the frontend host to
wherever the backend ends up, `CORS_ORIGIN` on the backend to wherever the
frontend ends up, and `DATABASE_URL`/`ADMIN_TOKEN` on the backend by hand.

**What's already handled**, so you don't need to think about it before
sharing a link:

- **Listings/orders persist in Postgres** once `DATABASE_URL` is set - the
  schema is created and demo data seeded automatically on first boot (see
  `src/db/migrate.ts`), and every write survives restarts/redeploys after
  that. No `DATABASE_URL` set (e.g. running locally with no `.env`) falls
  back to an in-memory store that resets every restart - fine for quick
  local dev, not for a link you're sharing.
- **Arbitrator actions require `ADMIN_TOKEN`** - resolving a dispute,
  generating its AI summary, and applying a fraud score to a listing all
  return `401` without the correct token, both from the API directly and
  from the frontend's `/disputes` page (which prompts for the token once
  and remembers it in that browser's `localStorage`). This is a single
  shared secret, not a real accounts/roles system - fine for one or a
  handful of trusted arbitrators, not a substitute for proper staff auth
  if this grows a real team.
- **Everyone else signs in with their wallet**, not a shared secret - see
  [Accounts, photos & search](#accounts-photos--search). Needs
  `JWT_SECRET`, which the Render blueprint generates for you automatically.

**Before pointing real users at it:**

- **A custom domain** works on either host by adding it in that service's
  dashboard and pointing your DNS (a CNAME, usually) at the value they
  give you.
- **Rotate `ADMIN_TOKEN`** if you ever suspect it leaked (shared with the
  wrong person, committed by accident, etc.) - update it in the host's
  Environment tab and share the new value only with whoever should have
  arbitrator access.

### 5. The Anchor program

```bash
anchor build   # requires the Solana/Anchor CLI
anchor test    # runs tests/escrow_marketplace.ts against a local validator
```

`cargo check -p escrow_marketplace` (plain Rust, no Anchor CLI needed)
verifies the program compiles.

## Known limitations & how to finish the loop

This was built in a sandbox without the Solana CLI or Anchor CLI installed,
so a few things are honestly stubbed rather than faked:

- **The program has not been deployed anywhere.** `programs/escrow_marketplace`
  compiles (`cargo check` passes, `cargo fmt --check` is clean) but has
  never been through `anchor build`/`anchor deploy`. The declared program
  ID is a freshly-generated placeholder keypair, not a real deployed
  program - replace it (`anchor keys sync`) before deploying for real.
- **The demo listings/orders are off-chain only.** The seed data in
  `app/backend/src/data/seedData.ts` carries placeholder wallet addresses
  (freshly generated keypairs whose private keys were discarded) - nobody
  can sign in as those demo sellers/buyers, and none of it has a real
  on-chain address. Listings/orders a real signed-in visitor creates are
  fully interactive under their own wallet. The frontend's Buy It Now flow
  uses the backend's escrow simulation directly rather than sending a
  doomed transaction to a non-existent listing PDA. Once you deploy the
  program and call `create_listing` for real, point the backend's stores
  at the real `Listing`/`Order` accounts (`solanaService.ts` already has
  the PDA derivations and a cluster health check to build on) and swap the
  frontend's Buy panel over to `buildCreateOrderInstructions`/
  `buildConfirmReceiptInstructions` (already written for the SPL/USDC
  model in `app/frontend/src/lib/anchorIx.ts`, just not wired up to real
  addresses yet).
- **The frontend's on-chain instruction builders are hand-encoded**
  (`app/frontend/src/lib/anchorIx.ts`), computing the Anchor instruction
  discriminator (`sha256("global:<name>")[..8]`) and Borsh-encoding the
  args directly, instead of using a `@coral-xyz/anchor` `Program` client.
  That client needs the IDL that `anchor build` generates
  (`target/idl/escrow_marketplace.json`); once you have it, switching to a
  typed `Program<EscrowMarketplace>` is a strict improvement (compile-time
  checked accounts/args) and the manual encoder can be deleted.
- **The Jupiter swap integration (`app/frontend/src/lib/jupiterSwap.ts`)
  is written but not exercised end-to-end here.** This sandbox's network
  egress allowlist doesn't reach `api.jup.ag` (or Solana devnet, which the
  swap output would need to land on anyway), so the quote/swap HTTP round
  trip couldn't be run or screenshotted while building this. The code
  matches Jupiter's documented v6 API shapes; wire it into the Buy panel's
  non-USDC path once you're running somewhere with outbound access to
  `api.jup.ag`, and test it against a real quote before trusting it with
  real funds.
- **SKR doesn't exist yet.** It's listed as a payment option
  (`isPlaceholderCurrency("SKR")` returns `true` everywhere) purely so the
  UI and API shape it correctly ahead of launch, priced at a hardcoded
  mock rate (`pricingService.ts`'s `MOCK_USD_RATES.SKR`). Once you mint
  and launch the real token, replace that constant with a live quote
  (Jupiter will route it automatically once it has liquidity) and drop
  the placeholder flag.
- **`resolve_dispute` isn't wired to a wallet in the UI.** The Disputes
  page's resolve buttons call the backend's demo endpoint directly
  (gated by `ADMIN_TOKEN` - see "Publishing this live" above - not open to
  every visitor). On a real deployment, resolving a dispute is an
  authority-signed on-chain instruction; the admin token is a reasonable
  stand-in for a small team, but it isn't the same as requiring the
  platform's actual authority keypair to sign.
- **Anchor's own IDL/TS types aren't generated**, so `tests/escrow_marketplace.ts`
  imports a `../target/types/escrow_marketplace` module that only exists
  after `anchor build`. The test file was written against the program's
  actual SPL/USDC instruction/account shapes (it mints a test 6-decimal
  token to stand in for USDC, since neither `anchor build` nor a local
  validator is available in this sandbox to run it against) and should
  run as-is once that build step has happened.

None of this blocks reading or extending the code - it's the difference
between "designed and unit-verifiable" and "deployed," and closing it is a
`solana-install` + `anchor build && anchor deploy` away.

## Disclaimer

This is a demonstration project. Nothing here is financial, legal, or
consumer-protection advice, the AI fraud screening and dispute summaries
are not a substitute for real trust & safety operations or legal
arbitration, and the program has not been security-audited - do not point
it at real money without one.
