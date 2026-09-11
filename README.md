# RWA AI - Tokenized Real World Assets, with AI-powered risk & due diligence

A full-stack RWA (Real World Asset) tokenization platform on Solana, with an
AI layer (Claude) doing the risk scoring, valuation sanity-checks, due
diligence write-ups, and investor Q&A that a human analyst would otherwise
do manually for every listed asset.

> **Status: reference implementation / scaffold.** The Anchor program
> compiles cleanly (`cargo check` passes) and the backend + frontend build
> and run end-to-end against an in-memory demo dataset. The program has
> **not been deployed** to any cluster - this sandbox has no Solana/Anchor
> CLI available (see [Known limitations](#known-limitations--how-to-finish-the-loop)
> for exactly what that means and how to close the gap).

## Why RWA + AI

Tokenizing a real-world asset (a property, an invoice pool, a PPA offtake
stream, a private credit note) is a documentation-heavy underwriting
problem before it's a blockchain problem: someone has to read the
appraisal, the title report, the leases, the debtor concentration, and
decide whether this is something you'd let retail investors buy fractional
shares of. This project pairs that with the actual tokenization:

- **On-chain (Solana / Anchor):** the source of truth for who owns what.
  Fractional ownership as SPL tokens, an investor KYC allow-list, and an
  asset lifecycle gated by a published risk score.
- **Off-chain (Claude via the Anthropic API):** the analyst. Reads an
  asset's description and supporting documents and produces a risk score,
  a valuation sanity-check, a due-diligence report, and answers investor
  questions grounded only in that asset's data.
- **Frontend (React + Solana wallet adapter):** the marketplace investors
  actually use - browse assets, read the AI reports, ask follow-up
  questions, connect a wallet, and invest.

The chain enforces *outcomes* (only KYC'd wallets can buy, only Active
assets can be invested in); the AI produces the *judgment* that a human
authority attests to on-chain via `approve_asset`. Solana programs can't
make outbound HTTP calls, so the AI step is necessarily off-chain - this
is the standard oracle-style pattern for bringing an off-chain assessment
on-chain.

## Architecture

```
┌──────────────────┐      HTTP       ┌───────────────────┐     Anthropic API    ┌───────────┐
│  React frontend  │◀───────────────▶│   Express backend  │◀─────────────────────▶│  Claude   │
│  (Vite, wallet-  │                 │  (TypeScript)       │   risk / valuation /  │ (claude-  │
│   adapter)        │                 │                     │   due diligence / Q&A │  opus-5)  │
└────────┬─────────┘                 └──────────┬──────────┘                      └───────────┘
         │ signs & sends transactions            │ reads (health check, future: decode
         │ (invest instruction)                  │ on-chain Asset/Registry accounts)
         ▼                                        ▼
┌──────────────────────────────────────────────────────────┐
│                Solana (devnet / localnet)                 │
│  rwa_tokenization Anchor program                           │
│  Registry → Asset (+ SPL mint) → KycRecord → vault (SOL)   │
└──────────────────────────────────────────────────────────┘
```

## Repository layout

```
programs/rwa_tokenization/   Anchor/Rust program: registry, assets, KYC, invest, vault
tests/rwa_tokenization.ts    Anchor mocha test suite (register → KYC → approve → invest → withdraw → freeze)
Anchor.toml, Cargo.toml      Anchor workspace config

app/backend/                 Express + TypeScript API
  src/services/aiService.ts    Claude integration: risk score, valuation, due diligence, chat
  src/services/solanaService.ts PDA derivation + read-side cluster/program health check
  src/data/assets.ts            In-memory demo asset store (swap for a DB / on-chain reads)
  src/routes/                   REST routes

app/frontend/                React + Vite + TypeScript dApp
  src/pages/Marketplace.tsx     Browse tokenized assets
  src/pages/AssetDetail.tsx     AI risk/valuation/due-diligence panels, chat, invest flow
  src/pages/Portfolio.tsx       Connected wallet's on-chain share holdings
  src/lib/anchorIx.ts           Hand-encoded `invest` instruction (no IDL/Anchor-CLI dependency)
  src/wallet/                   Solana wallet-adapter context (Wallet Standard auto-detection)
```

## The on-chain program (`programs/rwa_tokenization`)

Instructions:

| Instruction | Who | What it does |
|---|---|---|
| `initialize_registry` | platform authority | One-time setup of the global `Registry` account. |
| `register_asset` | asset originator | Lists a new asset: creates the `Asset` PDA and a zero-decimal SPL mint (mint authority = the asset PDA itself). Status starts `PendingReview`. |
| `set_kyc_status` | authority | Allow-lists (or revokes) an investor wallet after off-chain KYC/AML. |
| `approve_asset` | authority | Publishes the AI-generated risk score for a pending asset. Score ≤ 70 → `Active`; above → `Rejected`. This is the on-chain attestation of the backend's `assessRisk()` call. |
| `invest` | KYC'd investor | Buys `shares_amount` shares of an `Active` asset: SOL flows investor → asset vault PDA, shares mint 1:1 to the investor's (auto-created) associated token account. |
| `withdraw_funds` | asset originator | Withdraws raised SOL from the asset's vault. |
| `freeze_asset` | authority | Emergency/compliance freeze of an `Active` asset. |

State: `Registry` (authority, asset count), `Asset` (originator, type, name,
metadata URI, valuation, share economics, status, `ai_risk_score`, mint),
`KycRecord` (per-investor approval). All addresses are PDAs so client code
can derive them without an RPC round-trip (`programs/rwa_tokenization/src/lib.rs`
seeds are mirrored in both `app/backend/src/services/solanaService.ts` and
`app/frontend/src/lib/solana.ts`).

## The AI layer (`app/backend/src/services/aiService.ts`)

Four capabilities, each a single Claude API call (model: `claude-opus-5`,
adaptive thinking) with a strict "respond with only a JSON object" system
prompt and a tolerant JSON extractor on the response:

- **`assessRisk`** - 0-100 risk score + rating + factors. This is what an
  authority would relay into `approve_asset` on-chain.
- **`estimateValuation`** - sanity-checks the stated valuation against the
  asset's own documentation, explicit about not being a licensed appraisal.
- **`generateDueDiligence`** - investor-facing summary, strengths, risks,
  recommendation.
- **`answerAssetQuestion`** - Q&A grounded only in that asset's own
  description/documents, explicitly refuses to speculate beyond them.

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

`GET /api/health` reports whether the AI key is configured and whether the
configured Solana RPC/program is reachable.

### 3. Frontend

```bash
cp app/frontend/.env.example app/frontend/.env   # defaults are fine for local dev
npm run dev:frontend      # http://localhost:5173, proxies /api to the backend
```

Open http://localhost:5173 - browse the demo assets, generate AI risk
assessments / valuations / due-diligence reports, and chat about a
specific asset. Connect a Solana wallet (any Wallet Standard wallet -
Phantom, Solflare, Backpack, ...) to see the invest UI; since the demo
assets have no on-chain mint yet (see below), it explains that instead of
sending a doomed transaction.

### 4. The Anchor program

```bash
anchor build   # requires the Solana/Anchor CLI
anchor test    # runs tests/rwa_tokenization.ts against a local validator
```

`cargo check -p rwa_tokenization` (plain Rust, no Anchor CLI needed)
verifies the program compiles.

## Known limitations & how to finish the loop

This was built in a sandbox without the Solana CLI or Anchor CLI installed,
so a few things are honestly stubbed rather than faked:

- **The program has not been deployed anywhere.** `programs/rwa_tokenization`
  compiles (`cargo check` passes, `cargo fmt --check` is clean) but has
  never been through `anchor build`/`anchor deploy`. The declared program
  ID (`96fhowjcVma9sKzQuiStDvXZsPDc9GnafKfSAwdTkyCP`) is a freshly-generated
  placeholder keypair, not a real deployed program - replace it (`anchor
  keys sync`) before deploying for real.
- **The demo assets are off-chain only.** `app/backend/src/data/assets.ts`
  is an in-memory store with `mint: null, originator: null` for every
  seeded asset - there's no real SPL mint behind them. The frontend's
  invest flow detects this and explains it rather than sending a
  transaction that would fail. Once you deploy the program and call
  `register_asset`, point the backend's asset store at the real `Asset`/
  `Registry` accounts (`solanaService.ts` already has the PDA derivations
  and a cluster health check to build on) and the same invest UI will
  work against a live mint.
- **The frontend signs the `invest` instruction by hand**
  (`app/frontend/src/lib/anchorIx.ts`), computing the Anchor instruction
  discriminator (`sha256("global:invest")[..8]`) and Borsh-encoding the
  args directly, instead of using a `@coral-xyz/anchor` `Program` client.
  That client needs the IDL that `anchor build` generates
  (`target/idl/rwa_tokenization.json`); once you have it, switching to a
  typed `Program<RwaTokenization>` is a strict improvement (compile-time
  checked accounts/args) and the manual encoder can be deleted.
- **Anchor's own IDL/TS types aren't generated**, so `tests/rwa_tokenization.ts`
  imports a `../target/types/rwa_tokenization` module that only exists
  after `anchor build`. The test file itself was written against the
  program's actual instruction/account shapes and should run as-is once
  that build step has happened.

None of this blocks reading or extending the code - it's the difference
between "designed and unit-verifiable" and "deployed," and closing it is a
`solana-install` + `anchor build && anchor deploy` away.

## Disclaimer

This is a demonstration project. Nothing here is financial, legal, or
investment advice, the AI-generated risk scores and valuations are not a
substitute for licensed appraisal/underwriting, and the program has not
been security-audited - do not point it at real assets or real money
without one.
