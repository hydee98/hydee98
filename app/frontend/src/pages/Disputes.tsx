import { useEffect, useState } from "react";
import { api } from "../api/client";
import { lamportsToSol } from "../lib/solana";
import type { DisputeSummary, Listing, Order } from "../types";

export function Disputes() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([api.listOrders(), api.listListings()])
      .then(([ordersRes, listingsRes]) => {
        setOrders(ordersRes.orders.filter((o) => o.status === "Disputed"));
        setListings(Object.fromEntries(listingsRes.listings.map((l) => [l.id, l])));
      })
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  if (error) return <div className="page">Failed to load disputes: {error}</div>;
  if (!orders) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <h1>Disputes - arbitrator view</h1>
      <p className="subtitle">
        Demo-only admin view. In a real deployment, resolving a dispute
        calls the on-chain <code>resolve_dispute</code> instruction signed
        by the platform's authority key - not something a regular connected
        wallet can do.
      </p>

      {orders.length === 0 && <p className="muted">No open disputes.</p>}

      {orders.map((order) => (
        <DisputeCard
          key={order.id}
          order={order}
          listing={listings[order.listingId]}
          onResolved={load}
        />
      ))}
    </div>
  );
}

function DisputeCard({
  order,
  listing,
  onResolved,
}: {
  order: Order;
  listing: Listing | undefined;
  onResolved: () => void;
}) {
  const [summary, setSummary] = useState<DisputeSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const getSummary = async () => {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      setSummary((await api.getDisputeSummary(order.id)).summary);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Failed to summarize dispute");
    } finally {
      setLoadingSummary(false);
    }
  };

  const resolve = async (resolution: "ReleaseToSeller" | "RefundBuyer" | "Split") => {
    setResolving(true);
    try {
      await api.resolveDispute(order.id, resolution);
      onResolved();
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Failed to resolve dispute");
    } finally {
      setResolving(false);
    }
  };

  return (
    <section className="panel">
      <h3>{listing?.title ?? order.listingId}</h3>
      <p className="muted">
        Buyer: {order.buyerName} · {lamportsToSol(order.amountLamports)} SOL in escrow
      </p>

      <div className="chat-log">
        {order.disputeMessages.map((m, i) => (
          <div key={i} className={`chat-message chat-${m.author === "buyer" ? "user" : "assistant"}`}>
            <span className="chat-role">{m.author}</span>
            <p>{m.content}</p>
          </div>
        ))}
      </div>

      <div className="panel-header">
        <h4 style={{ margin: 0 }}>AI Dispute Summary</h4>
        <button onClick={getSummary} disabled={loadingSummary}>
          {loadingSummary ? "Thinking…" : summary ? "Regenerate" : "Get AI summary"}
        </button>
      </div>
      {summaryError && <p className="error-banner">{summaryError}</p>}
      {summary && (
        <>
          <p>{summary.summary}</p>
          <div className="two-col">
            <div>
              <h4>Buyer's claim</h4>
              <p>{summary.buyerClaim}</p>
            </div>
            <div>
              <h4>Seller's claim</h4>
              <p>{summary.sellerClaim}</p>
            </div>
          </div>
          <p>
            <strong>
              Suggested resolution: {summary.suggestedResolution}
              {summary.suggestedResolution === "Split" &&
                ` (seller ${summary.suggestedSellerSharePct}%)`}
            </strong>
          </p>
          <p className="muted">{summary.reasoning}</p>
        </>
      )}

      <div className="order-actions">
        <button disabled={resolving} onClick={() => resolve("ReleaseToSeller")}>
          Release to seller
        </button>
        <button disabled={resolving} className="secondary-button" onClick={() => resolve("RefundBuyer")}>
          Refund buyer
        </button>
        <button disabled={resolving} className="secondary-button" onClick={() => resolve("Split")}>
          Split 50/50
        </button>
      </div>
    </section>
  );
}
