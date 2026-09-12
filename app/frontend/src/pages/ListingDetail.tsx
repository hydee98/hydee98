import { useWallet } from "@solana/wallet-adapter-react";
import { Home, Package } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { AdminGate } from "../components/AdminGate";
import { FraudBadge } from "../components/FraudBadge";
import { ListingStatusBadge } from "../components/ListingStatusBadge";
import { SignInGate } from "../components/SignInGate";
import { useAuth } from "../context/AuthContext";
import { lamportsToSol } from "../lib/solana";
import type { ChatMessage, FraudScreening, Listing, PriceSuggestion } from "../types";

/** Generic wrapper for the independent AI panels below - each one is "idle
 * until you ask for it" so a page load never fires Claude calls a visitor
 * didn't request. */
function useAiAction<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, run };
}

export function ListingDetail() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    api
      .getListing(id)
      .then((res) => setListing(res.listing))
      .catch((err) => setLoadError(err.message));
  };

  useEffect(load, [id]);

  const fraud = useAiAction<FraudScreening>(async () => {
    if (!id) throw new Error("missing listing id");
    return (await api.getFraudScreening(id)).screening;
  });
  const price = useAiAction<PriceSuggestion>(async () => {
    if (!id) throw new Error("missing listing id");
    return (await api.getPriceSuggestion(id)).suggestion;
  });

  if (loadError) return <div className="page">Failed to load listing: {loadError}</div>;
  if (!listing) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <div className="asset-detail">
        <div className="asset-detail-header">
          <div>
            <span className="asset-type">
              {listing.category}
              {listing.category === "Property" && (listing.listingType === "ToLet" ? " · To Let" : " · For Sale")}
            </span>
            <h1>{listing.title}</h1>
            {listing.location !== "N/A" && <p className="asset-location">{listing.location}</p>}
          </div>
          <div className="asset-detail-badges">
            <ListingStatusBadge status={listing.status} />
            <FraudBadge score={listing.aiFraudScore} />
          </div>
        </div>

        <Gallery images={listing.images} title={listing.title} category={listing.category} />

        <div className="asset-detail-main">
          <p className="asset-description">{listing.description}</p>

          {listing.aiFraudFlags.length > 0 && (
            <section className="panel">
              <h3>Flagged concerns</h3>
              <ul>
                {listing.aiFraudFlags.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="ai-panels">
            <AiPanel
              title="AI Fraud Screening"
              buttonLabel="Run fraud screen"
              state={fraud}
              onApplied={load}
              listingId={listing.id}
              applyKind="fraud"
              render={(f) => (
                <>
                  <p>
                    <strong>
                      {f.recommendation} - score {f.score}/100
                    </strong>
                  </p>
                  <p>{f.summary}</p>
                  {f.flags.length > 0 && (
                    <ul>
                      {f.flags.map((flag, i) => (
                        <li key={i}>{flag}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            />

            <AiPanel
              title="AI Price Suggestion"
              buttonLabel="Get price suggestion"
              state={price}
              render={(p) => (
                <>
                  <p>
                    <strong>
                      Suggested: £{p.suggestedPriceGBP.toLocaleString()} (range £
                      {p.lowGBP.toLocaleString()} - £{p.highGBP.toLocaleString()})
                    </strong>
                  </p>
                  <p>{p.reasoning}</p>
                </>
              )}
            />
          </div>

          <ChatPanel listingId={listing.id} />
        </div>

        <div className="asset-detail-side">
          <BuyPanel listing={listing} />
        </div>
      </div>

      <p className="disclaimer">
        This platform and its AI-generated content are for demonstration
        purposes only. Payment is held in escrow and only released once you
        confirm receipt - always inspect items/property before confirming.
      </p>
    </div>
  );
}

function Gallery({
  images,
  title,
  category,
}: {
  images: string[];
  title: string;
  category: Listing["category"];
}) {
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const current = !failed.has(active) ? images[active] : undefined;
  const visibleThumbs = images.map((src, i) => ({ src, i })).filter(({ i }) => !failed.has(i));

  return (
    <div className="gallery">
      <div className="gallery-main">
        {current ? (
          <img
            src={current}
            alt={title}
            onError={() => setFailed((prev) => new Set(prev).add(active))}
          />
        ) : (
          <div className="gallery-main-placeholder">
            {category === "Property" ? <Home size={56} /> : <Package size={56} />}
          </div>
        )}
      </div>
      {visibleThumbs.length > 1 && (
        <div className="gallery-thumbs">
          {visibleThumbs.map(({ src, i }) => (
            <button
              key={i}
              type="button"
              className={i === active ? "gallery-thumb active" : "gallery-thumb"}
              onClick={() => setActive(i)}
              aria-label={`Photo ${i + 1}`}
            >
              <img src={src} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AiPanel<T>({
  title,
  buttonLabel,
  state,
  render,
  onApplied,
  listingId,
  applyKind,
}: {
  title: string;
  buttonLabel: string;
  state: { data: T | null; loading: boolean; error: string | null; run: () => void };
  render: (data: T) => React.ReactNode;
  onApplied?: () => void;
  listingId?: string;
  applyKind?: "fraud";
}) {
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const applyFraudReview = async () => {
    if (!listingId || applyKind !== "fraud" || !state.data) return;
    const screening = state.data as unknown as FraudScreening;
    setApplying(true);
    setApplyError(null);
    try {
      await api.reviewListing(listingId, screening.score, screening.flags);
      onApplied?.();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to apply score");
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="panel ai-panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <button onClick={state.run} disabled={state.loading}>
          {state.loading ? "Thinking…" : state.data ? "Regenerate" : buttonLabel}
        </button>
      </div>
      {state.error && <p className="error-banner">{state.error}</p>}
      {state.data && render(state.data)}
      {state.data && applyKind === "fraud" && (
        <AdminGate prompt="Applying a score is an authority action - enter the admin key.">
          {applyError && <p className="error-banner">{applyError}</p>}
          <button onClick={applyFraudReview} disabled={applying} className="secondary-button">
            {applying ? "Applying…" : "Apply this score to the listing"}
          </button>
        </AdminGate>
      )}
      {!state.data && !state.error && !state.loading && (
        <p className="muted">Not yet generated for this listing.</p>
      )}
    </section>
  );
}

function ChatPanel({ listingId }: { listingId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setQuestion("");
    try {
      const { answer } = await api.askListingQuestion(listingId, trimmed, messages);
      setMessages([...nextMessages, { role: "assistant", content: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get a response");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <h3>Ask about this listing</h3>
      <div className="chat-log">
        {messages.length === 0 && (
          <p className="muted">Ask a question about the item/property, condition, or terms.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-message chat-${m.role}`}>
            <span className="chat-role">{m.role === "user" ? "You" : "Assistant"}</span>
            <p>{m.content}</p>
          </div>
        ))}
      </div>
      {error && <p className="error-banner">{error}</p>}
      <div className="chat-input-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="e.g. Is the price negotiable?"
          disabled={loading}
        />
        <button onClick={send} disabled={loading || !question.trim()}>
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>
    </section>
  );
}

function BuyPanel({ listing }: { listing: Listing }) {
  const { publicKey } = useWallet();
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const isOwnListing = isSignedIn && publicKey && listing.seller === publicKey.toBase58();
  const canBuy = listing.status === "Active" && !isOwnListing;

  const handleBuy = async () => {
    setStatus(null);
    setBusy(true);
    try {
      const { order } = await api.createOrder(listing.id);
      setStatus(`Payment escrowed. Order ${order.id} created - view it under Orders to confirm receipt or open a dispute.`);
      setTimeout(() => navigate("/orders"), 1200);
    } catch (err) {
      setStatus(err instanceof Error ? `Purchase failed: ${err.message}` : "Purchase failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel invest-panel">
      <h3>{listing.listingType === "ToLet" ? "Rent this property" : "Buy It Now"}</h3>
      {!canBuy && listing.status !== "Active" && (
        <p className="muted">This listing isn't open for offers right now.</p>
      )}
      {isOwnListing && <p className="muted">This is your own listing.</p>}
      <p className="muted">
        Runs through the backend's escrow simulation in this demo (no
        deployed on-chain program yet - see the README); the real
        <code> create_order</code>/<code>confirm_receipt</code> instructions
        are ready in <code>src/lib/anchorIx.ts</code>.
      </p>
      <p className="invest-cost">
        {lamportsToSol(listing.priceLamports)} SOL (£{listing.guidePriceGBP.toLocaleString()})
      </p>

      {canBuy && (
        <SignInGate prompt="Sign in with your wallet to buy - your wallet is your account, no separate signup.">
          <button onClick={handleBuy} disabled={busy}>
            {busy ? "Processing…" : listing.listingType === "ToLet" ? "Pay first month + deposit" : "Buy It Now"}
          </button>
        </SignInGate>
      )}
      {status && <p className="invest-status">{status}</p>}
    </section>
  );
}
