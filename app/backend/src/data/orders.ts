import type { DisputeMessage, Order } from "../types.js";

/**
 * In-memory demo order (escrow) store - mirrors the on-chain `Order`
 * accounts. See data/listings.ts for the same pattern/caveat: swap for a
 * database, or for reading real on-chain accounts, without touching routes.
 */
const orders = new Map<string, Order>();

function seed() {
  const demo: Order[] = [
    {
      id: "order-1",
      onChainOrderId: 0,
      listingId: "listing-2",
      buyerName: "buyer-jane",
      amountLamports: 22_000_000,
      status: "Funded",
      disputeReasonUri: null,
      disputeMessages: [],
      createdAt: "2026-08-25T09:00:00.000Z",
    },
    {
      id: "order-2",
      onChainOrderId: 0,
      listingId: "listing-6",
      buyerName: "buyer-tom",
      amountLamports: 3_200_000,
      status: "Disputed",
      disputeReasonUri: "ipfs://dispute-evidence-order-2",
      disputeMessages: [
        {
          author: "buyer",
          content:
            "The bike arrived with a cracked frame near the rear shock mount - not mentioned in the listing at all. I have photos. I don't think this is safe to ride and I'd like a refund.",
          createdAt: "2026-08-29T10:00:00.000Z",
        },
        {
          author: "seller",
          content:
            "The bike left me in perfect condition - I have a video from the day before shipping showing no damage. This must have happened in transit with the courier, not something I did.",
          createdAt: "2026-08-29T15:30:00.000Z",
        },
        {
          author: "buyer",
          content:
            "The box itself wasn't damaged at all, no crush marks, which is why I don't think this was a shipping issue. Still happy to share my unboxing photos for reference.",
          createdAt: "2026-08-29T16:10:00.000Z",
        },
      ],
      createdAt: "2026-08-27T11:00:00.000Z",
    },
  ];

  for (const order of demo) orders.set(order.id, order);
}
seed();

export function listOrders(filter?: { listingId?: string }): Order[] {
  const all = Array.from(orders.values());
  if (filter?.listingId) return all.filter((o) => o.listingId === filter.listingId);
  return all;
}

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}

export function createOrder(input: {
  listingId: string;
  buyerName: string;
  amountLamports: number;
}): Order {
  const id = `order-${orders.size + 1}-${Date.now().toString(36)}`;
  const order: Order = {
    id,
    onChainOrderId: null,
    listingId: input.listingId,
    buyerName: input.buyerName,
    amountLamports: input.amountLamports,
    status: "Funded",
    disputeReasonUri: null,
    disputeMessages: [],
    createdAt: new Date().toISOString(),
  };
  orders.set(id, order);
  return order;
}

export function updateOrder(id: string, patch: Partial<Order>): Order | undefined {
  const existing = orders.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };
  orders.set(id, updated);
  return updated;
}

export function addDisputeMessage(id: string, message: DisputeMessage): Order | undefined {
  const existing = orders.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, disputeMessages: [...existing.disputeMessages, message] };
  orders.set(id, updated);
  return updated;
}
