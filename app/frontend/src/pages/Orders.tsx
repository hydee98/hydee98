import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { OrderStatusBadge } from "../components/OrderStatusBadge";
import { lamportsToSol } from "../lib/solana";
import type { Listing, Order } from "../types";

export function Orders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [disputeDraft, setDisputeDraft] = useState<Record<string, string>>({});

  const load = () => {
    Promise.all([api.listOrders(), api.listListings()])
      .then(([ordersRes, listingsRes]) => {
        setOrders(ordersRes.orders);
        setListings(Object.fromEntries(listingsRes.listings.map((l) => [l.id, l])));
      })
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const runAction = async (orderId: string, action: () => Promise<unknown>) => {
    setBusyOrderId(orderId);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyOrderId(null);
    }
  };

  if (error) return <div className="page">Failed to load orders: {error}</div>;
  if (!orders) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <h1>Orders &amp; Escrow</h1>
      <p className="subtitle">
        Every purchase pays into an escrow account first. Confirm receipt to
        release funds to the seller, or open a dispute if something's wrong
        before you do.
      </p>

      <ul className="holdings-list orders-list">
        {orders.map((order) => {
          const listing = listings[order.listingId];
          const busy = busyOrderId === order.id;
          return (
            <li key={order.id} className="order-row">
              <div className="order-row-main">
                <div>
                  <Link to={`/listing/${order.listingId}`}>{listing?.title ?? order.listingId}</Link>
                  <p className="muted">
                    Buyer: {order.buyerName} · {lamportsToSol(order.amountLamports)} SOL escrowed
                  </p>
                </div>
                <OrderStatusBadge status={order.status} />
              </div>

              {order.status === "Funded" && (
                <div className="order-actions">
                  <button
                    disabled={busy}
                    onClick={() => runAction(order.id, () => api.confirmReceipt(order.id))}
                  >
                    Confirm receipt
                  </button>
                  <button
                    disabled={busy}
                    className="secondary-button"
                    onClick={() => runAction(order.id, () => api.cancelOrder(order.id))}
                  >
                    Cancel order
                  </button>
                  <div className="dispute-inline">
                    <input
                      type="text"
                      placeholder="Describe the problem…"
                      value={disputeDraft[order.id] ?? ""}
                      onChange={(e) =>
                        setDisputeDraft((d) => ({ ...d, [order.id]: e.target.value }))
                      }
                    />
                    <button
                      disabled={busy || !disputeDraft[order.id]?.trim()}
                      className="secondary-button"
                      onClick={() =>
                        runAction(order.id, () =>
                          api.openDispute(order.id, "buyer", disputeDraft[order.id])
                        )
                      }
                    >
                      Open dispute
                    </button>
                  </div>
                </div>
              )}

              {order.status === "Disputed" && (
                <p className="muted">
                  Dispute open - see the <Link to="/disputes">Disputes</Link> page for the
                  arbitrator view and AI-generated summary.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
