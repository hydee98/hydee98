# MarketAI - Peer-to-Peer Marketplace with Crypto Escrow + AI

A Zoopla/eBay-style marketplace - list a property (for sale or to let) or a
general item, get paid in SOL - where payment sits in an on-chain escrow
vault until the buyer confirms receipt/handover, and an AI layer (Claude)
screens listings for fraud, suggests fair prices, answers buyer questions,
and briefs the human arbitrator when a dispute is opened.

> **Status: reference implementation / scaffold.** The Anchor program
> compiles cleanly (`cargo check` passes) and the backend + frontend build
> and run end-to-end - Postgres-backed and persistent when `DATABASE_URL`
> is set, an in-memory demo dataset otherwise. The program has **not been
> deployed** to any cluster - this sandbox has no Solana/Anchor CLI
> available (see [Known limitations](#known-limitations--how-to-finish-the-loop)
> for exactly what that means and how to close the gap).

## The model

- **List it.** A seller lists a property (for sale or to let) or a general
  item at a fixed price. Every new listing starts `PendingReview`.
- **AI screens it.** Before it goes live, Claude reads the listing for scam
  signals - pressure tactics, "pay off-platform", prices that don't add up,
  vague descriptions - and produces a fraud score. Low score → `Active`;
  high score → `Flagged` for human review, not an automatic takedown.
- **Buy It Now.** A buyer pays the listed price in SOL into a per-order
  escrow vault. No haggling in this version - it's a fixed-price purchase,
  like eBay's Buy It Now.
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
         │ signs & sends transactions            │ reads (health check, future: decode
         │ (create_order / confirm_receipt)      │ on-chain Listing/Order/Marketplace accounts)
         ▼                                        ▼
┌──────────────────────────────────────────────────────────┐
│                Solana (devnet / localnet)                 │
│  escrow_marketplace Anchor program                         │
│  Marketplace → Listing → Order (+ SOL vault) → dispute      │
└──────────────────────────────────────────────────────────┘
```

## Repository layout

```
programs/escrow_marketplace/  Anchor/Rust program: listings, escrow orders, disputes
tests/escrow_marketplace.ts   Anchor mocha test suite
Anchor.toml, Cargo.toml       Anchor workspace config

app/backend/                  Express + TypeScript API
  src/services/aiService.ts     Claude integration: fraud screen, price suggestion, chat, dispute summary
  src/services/solanaService.ts PDA derivation + read-side cluster/program health check
  src/data/listings.ts          In-memory demo listing store (swap for a DB / on-chain reads)
  src/data/orders.ts            In-memory demo order/escrow store
  src/routes/                   REST routes

app/frontend/                 React + Vite + TypeScript dApp
  src/pages/Browse.tsx           Browse listings, filter by Property/Item
  src/pages/ListingDetail.tsx    AI fraud/price panels, chat, Buy It Now
  src/pages/Orders.tsx           Confirm receipt / cancel / open a dispute
  src/pages/Disputes.tsx         Arbitrator view: AI dispute summary + resolve
  src/pages/CreateListing.tsx    Seller "list something for sale" form
  src/lib/anchorIx.ts            Hand-encoded create_order/confirm_receipt (no IDL/Anchor-CLI dependency)
  src/wallet/                    Solana wallet-adapter context (Wallet Standard auto-detection)
```

## The on-chain program (`programs/escrow_marketplace`)

Instructions:

| Instruction | Who | What it does |
|---|---|---|
| `initialize_marketplace` | platform authority | One-time setup of the global `Marketplace` account. |
| `create_listing` | seller | Lists a `Property` (for sale or to let) or an `Item` (always for sale) at a fixed price. Starts `PendingReview`. |
| `review_listing` | authority | Publishes the AI fraud score. Score ≤ 60 → `Active`; above → `Flagged`. This is the on-chain attestation of the backend's `screenListingForFraud()` call. |
| `remove_listing` | authority | Pulls a listing at any time (compliance), as long as no order is attached. |
| `create_order` | buyer | Buy-It-Now: pays the listing price into a per-order escrow vault PDA. Listing moves to `UnderOffer`. |
| `confirm_receipt` | buyer | Confirms delivery/handover - releases the full escrow to the seller. |
| `cancel_order` | buyer or seller | Calls off an unreleased order; buyer is refunded in full, listing re-opens. |
| `open_dispute` | buyer or seller | Flags a problem before receipt is confirmed; funds stay locked. |
| `resolve_dispute` | authority (arbitrator) | Releases to the seller, refunds the buyer, or splits the escrow by basis points. |

State: `Marketplace` (authority, listing count), `Listing` (seller,
category, type, title, metadata URI, price, status, `ai_fraud_score`,
`order_count`), `Order` (listing, buyer, seller, amount, status, dispute
evidence URI). All addresses are PDAs so client code can derive them
without an RPC round-trip - seeds are mirrored in both
`app/backend/src/services/solanaService.ts` and `app/frontend/src/lib/solana.ts`.

## The AI layer (`app/backend/src/services/aiService.ts`)

Four capabilities, each a Claude API call (model: `claude-opus-5`, adaptive
thinking) with a strict "respond with only a JSON object" system prompt
(except chat, which is free text) and a tolerant JSON extractor on the
response:

- **`screenListingForFraud`** - 0-100 fraud score + recommendation +
  concrete red flags. What an authority would relay into `review_listing`
  on-chain.
- **`suggestPrice`** - a fair-price range in GBP given the listing's own
  description, explicit about having no live market data feed.
- **`answerListingQuestion`** - buyer Q&A grounded only in that listing's
  own description, refuses to invent condition details or guarantees.
- **`summarizeDispute`** - reads both sides' dispute messages and briefs
  the arbitrator with a neutral summary and a suggested resolution - it
  recommends, a human decides.

All four gracefully degrade to a clear `503` ("AI features are not
configured: set ANTHROPIC_API_KEY...") when no key is present, so the rest
of the app keeps working without one.

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

That's enough to run everything except the arbitrator actions (resolving a
dispute, its AI summary, applying a fraud score), which need `ADMIN_TOKEN`
set - any string works locally. Leave `DATABASE_URL` unset to use the
in-memory store, or point it at a local Postgres to test persistence (see
`.env.example` for the connection string shape).

`GET /api/health` reports whether the AI key, the database, and the admin
token are configured, and whether the configured Solana RPC/program is
reachable.

### 3. Frontend

```bash
cp app/frontend/.env.example app/frontend/.env   # defaults are fine for local dev
npm run dev:frontend      # http://localhost:5173, proxies /api to the backend
```

Open http://localhost:5173 - browse the demo listings (a house for sale, a
flat to let, a few items - including one deliberately scammy-sounding
listing so you can see the fraud screen actually flag something), run the
AI fraud/price panels, chat about a listing, and walk through Buy It Now →
Orders → confirm receipt or open a dispute → Disputes (arbitrator view with
the AI summary).

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
   backend service's Environment tab. `DATABASE_URL` and `ADMIN_TOKEN` are
   wired up automatically - Postgres's connection string is injected from
   the database resource, and `ADMIN_TOKEN` is a random secret Render
   generates for you (`generateValue: true`). Find that generated value
   afterward in the backend service's Environment tab - you'll need it to
   unlock the arbitrator actions on `/disputes`.
4. Both web services get a `https://<service-name>.onrender.com` URL by
   default. `render.yaml` already points `VITE_API_BASE_URL` at the backend
   service's URL and `CORS_ORIGIN` at the frontend's, using the service
   names above - if you rename either service, update both.
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
- **The demo listings/orders are off-chain only.** `app/backend/src/data/`
  is an in-memory store; every seed listing has `seller: null` and no real
  on-chain address. The frontend's Buy It Now flow uses the backend's
  escrow simulation directly rather than sending a doomed transaction to a
  non-existent listing PDA. Once you deploy the program and call
  `create_listing` for real, point the backend's stores at the real
  `Listing`/`Order` accounts (`solanaService.ts` already has the PDA
  derivations and a cluster health check to build on) and swap the
  frontend's Buy panel over to `buildCreateOrderInstruction`/
  `buildConfirmReceiptInstruction` (already written in
  `app/frontend/src/lib/anchorIx.ts`, just not wired up to real addresses
  yet).
- **The frontend's on-chain instruction builders are hand-encoded**
  (`app/frontend/src/lib/anchorIx.ts`), computing the Anchor instruction
  discriminator (`sha256("global:<name>")[..8]`) and Borsh-encoding the
  args directly, instead of using a `@coral-xyz/anchor` `Program` client.
  That client needs the IDL that `anchor build` generates
  (`target/idl/escrow_marketplace.json`); once you have it, switching to a
  typed `Program<EscrowMarketplace>` is a strict improvement (compile-time
  checked accounts/args) and the manual encoder can be deleted.
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
  actual instruction/account shapes and should run as-is once that build
  step has happened.

None of this blocks reading or extending the code - it's the difference
between "designed and unit-verifiable" and "deployed," and closing it is a
`solana-install` + `anchor build && anchor deploy` away.

## Disclaimer

This is a demonstration project. Nothing here is financial, legal, or
consumer-protection advice, the AI fraud screening and dispute summaries
are not a substitute for real trust & safety operations or legal
arbitration, and the program has not been security-audited - do not point
it at real money without one.
